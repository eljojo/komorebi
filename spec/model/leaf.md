# The leaf

*One leaf, as material and as shape: what it does to the light that meets it, and the outline it casts.*

Under the trees José put it in four words: *"trunk, branch, twig, leave."* The leaf is the last tree. It is grown from its own veins the way the crown is grown from its twigs, and it passes light by the same law the whole canopy does. Where it hangs is [`canopy.md`](canopy.md); how its colour changes through the year is [`season.md`](season.md); how the many leaves are summed into a cast, a fill and a view of the sky is [`transport.md`](transport.md), [`fill.md`](fill.md) and [`sky-view.md`](sky-view.md).

## The leaf in the model

A leaf, as the model holds it, is small: the depth layer it belongs to, a rest position in the canopy plane, a size, an orientation, an outline, an **RGB transmittance**, and the spring state that moves it ([`motion.md`](motion.md)). It does not know where the sun is. That separation is deliberate: the leaf is a material and a shape, and the light is the transport's business.

A leaf does two things to light. Its **material** sets how much of each colour gets through and in what form: as a continuing beam, or scattered in every direction. Its **shape** sets where on the plane it does so.

The fact that organises the material is the one José saw on the ground: **the dark areas are a dim green, not black.** Light passed through thin leaves, and chlorophyll passes green while it absorbs red and blue. But a leaf is **frosted glass, not stained glass**. Almost everything it passes is scattered, so a leaf four metres up throws a *dark* shadow, and its colour spreads over the floor beneath it. The green of the shade is collective: thousands of lit leaves, each sending its own colour down in every direction, summed. It is never a picture that any one leaf paints inside its own shadow.

## Transmittance, by Beer's law, per channel

**Law.** A leaf has an optical depth τ per channel, and passes `e^(−τ)` of each. A summer leaf is deep in red and blue and shallow in green. Optical depth is the quantity the model carries, not transmittance, because depths **add**: light must clear every leaf in its way, transmittances multiply, and `−ln` turns the product into a sum. Leaves therefore accumulate in any order with no sorting, and overlaps darken correctly by themselves.

Because depth is per channel, two overlapping leaves are twice as deep: darker *and* greener. The green of the shade falls out of Beer's law; it is never painted on.

A look sets its summer leaf's colour as a transmittance per channel (`trans_r`, `trans_g`, `trans_b`), and that look's τ is `−ln` of it. Every later colour of the leaf, autumn's included, is a new producer of the same per-channel τ: pigments are basis vectors of optical depth, and nothing downstream of the leaf learns they exist ([`season.md`](season.md)).

## What one leaf stamps

The bake that turns leaves into depth layers is [`canopy.md`](canopy.md)'s. What any one leaf contributes to it is three things.

**Its true shape, foreshortened by its tilt.** A leaf face-on blocks its full area; edge-on it blocks almost nothing. Its footprint is its outline projected by its orientation, never a fixed blob: each leaf rests at a tilt drawn up to `max_tilt` of a right angle (0.8 by default), the wind rocks it about that, and its short half-axis is the face-on one times the cosine of the sum, never below a twentieth. When a leaf flutters, its footprint shrinks and swells and winks small gaps open and shut: **a real part of the glisten lives here, in the stamp**, not in transport.

**A soft edge that is an area fraction.** A leaf edge crossing a texel covers only part of it. The texel records both what fraction of it the leaf covers and the leaf's depth over that fraction. How those two numbers are read back is the subject of *a texel is a mixture*, below; reading them wrongly was the leaf's longest-standing error.

**Its fade.** A leaf can be partly present: the marginal leaf that a fractional density adds, the marginal tree, a leaf letting go in autumn. Its presence `f` scales the leaf's area in the stamp, so a leaf at `f` is the same leaf over `f` of its footprint ([`canopy.md`](canopy.md) owns why leaves fade; [`season.md`](season.md) owns abscission).

So one texel of a layer holds two numbers, summed over every leaf that touches it: the **optical depth** `τ = Σ τ_i·cov_i` per channel, and the **coverage** `c = Σ cov_i`, each leaf's `cov` already carrying its fade. Nothing else about the leaves reaches the light.

## The sieve: walls and cells

A leaf is not one tissue. Bright vein walls sit beside darker cells between them, and **Beer's law is convex**, so the light through the whole leaf is the mean of the two transmittances, not the transmittance of the mean depth:

> `T = f_w·e^(−τ_wall) + (1−f_w)·e^(−τ_cell)`, so `τ_j = −ln(f_w·e^(−τ_wall) + (1−f_w)·e^(−τ_cell))`

where `f_w` is the share of the leaf that is wall (`wall_fraction`). **Law.** By Jensen's inequality τ_j is never deeper than the mean of the two depths, and the gap between them is the point: a small share of clear wall lifts a deep leaf far more than the mean suggests. A red leaf held to the sky glows orange at its veins and reads lighter than its pigment says, which no per-channel gain on τ can do.

The cell's depth is the leaf's pigment state ([`season.md`](season.md)). The wall's is the same state with the anthocyanin removed, because vein tissue makes none: the veins stay gold while the cells go red. While a leaf has not begun to turn, wall and cell are one tissue and the mixture is the identity; the leaf carries the look's authored τ unchanged. With `f_w = 0` the leaf is the cell exactly. It is the law of a two-tissue leaf, not a knob for brightening.

The sieve is a **mean**. The engine places no veins: every leaf is one mixture with no vein geometry, so two overlapping leaves multiply two independent means rather than two aligned vein patterns. The maze itself is drawn only in the held leaf, below.

## A leaf is not a window: the ballistic and diffuse split

A real leaf's mesophyll scatters what it passes. What a leaf transmits is split:

> `T = T_b + T_d`, `T_b = (1−d)·T` the **ballistic** share, which keeps travelling as a beam, `T_d = d·T` the **diffuse** share, which leaves in every direction

with `d` the diffuse fraction (`leaf_diffuse`). **Law** in form; physically `d` is about 0.95.

The beam therefore sees `(1−d)·T`. That is not a new pigment but a **neutral depth** on top of the leaf's own:

> `k = −ln(1−d)`, clamped at `k ≤ 6`, so a leaf's ballistic depth is `τ + k`

`k` is the same in all three channels because the split is set by the leaf's scattering structure, not by its pigments. The ballistic residue keeps the leaf's hue, and what left the beam is the leaf's own hue at the level `d·T`. The clamp is where the beam is already `e^(−6)`, a quarter of a percent: it keeps `k` finite as `d` approaches 1 and changes nothing visible.

The split makes the shadow honest. Treated as ballistic, every leaf painted its own colour as a sharp image inside its own shadow, and two overlapping leaves of complementary colour (green over red) multiplied to near black: the mid-fall mud. With the split, the shadow is dark and the colour is delivered as light from every direction, by the fill.

The same two numbers serve every reader. The cast cameras take the ballistic share as the beam ([`transport.md`](transport.md)). The fill takes the full transmittance for skylight and for the light a leaf sends on down, and the difference `T − T_b` as the leaf's own diffuse emission ([`fill.md`](fill.md)). The sky view sees `T_b` as what of the sun's disk shows through a leaf and `T − T_b` as the leaf's glow: a lantern, not a window ([`sky-view.md`](sky-view.md)). Without the fill open, the diffuse share is delivered nowhere and the leaves simply leave their sun-images.

**The skylight needs no split.** For a uniform sky, diffuse transmission through Lambertian leaves equals the ballistic transmission to first order. So the sky reaching the floor through the canopy is `T`, and only the collimated sun is split. This is an **approximation** of first order, named below.

## A texel is a mixture, not a slab

The bake's sum `τ = Σ τ_i·cov_i` is exact where leaves **fill** a texel and stack: optical depth adds. At an **edge** it is not. A texel 30% under a leaf of blue depth 2.8 stores τ = 0.84; read as a slab of that depth it passes `e^(−0.84) = 0.43`, but it is 70% open sky and 30% dark leaf, and passes 0.72. The bake averages **depth** over the texel, and light averages **transmittance**; `e^(−mean τ)` is not `mean e^(−τ)`. Nearly half of every stamp's area is soft edge, so this is not a corner of the picture.

So every reader reconstructs the **mixture** from the same two stored numbers. With `a = min(c, 1)` the texel's leaf area:

> `τ̄ = τ/a`  the depth of the representative leaf
> `κ = k·c/a`  the neutral depth, `k` per leaf
> `T = (1−a) + a·e^(−τ̄)`  what the texel truly passes: the hue, the skylight, the light sent on down
> `T_b = (1−a) + a·e^(−τ̄ − κ)`  the ballistic share: the beam, the sunlight reaching a lower layer, the disk seen through it
> `emit = T − T_b`  the diffuse emission; the gap emits nothing

**Law** for the readings; **approximation** in what a texel is assumed to contain (one representative leaf and a gap). The properties that make it the right reading:

- **τ̄ is exact for one leaf** and **fade-invariant**: a leaf at fade `f` is the same leaf over `f` of the area, and depth and coverage scale together.
- **It is bilinear-safe.** An interpolated pair is a coverage-weighted mean of the leaves' depths, so a filtered read across an edge never blends the depth toward zero as reading τ alone does.
- **κ takes k per leaf**, and `c/a` keeps it deep where leaves stack.
- **Emission is `T − T_b` by definition**, so `T_b ≤ T` always, and the telescoping identities the fill and the sky view rest on hold by construction.
- **An interior is unchanged.** At `c ≥ 1` the formulas are the slab, so the inside of every leaf is what it always was; only what a gap changes moves.
- A texel with essentially no coverage is **empty**: `T = T_b = 1`.

**The hue of a leaf is read from the leaf, never from the mixture.** Wherever a reader needs a leaf's colour as a direction (not a level), it normalises `e^(−τ̄)`, the representative leaf's own transmittance. The mixture's gap share passes every channel alike and would whiten the hue into one the leaf never had; a pure gap glows nothing.

### Where it is exact, and where it is not

- **Exact:** one leaf over any fraction of a texel (`c ≤ 1`); any number of leaves **stacked over the whole texel** (at `c = 2`: `T = T₁T₂`, `T_b = T₁T₂(1−d)²`, `emit = T₁T₂(1 − (1−d)²)`).
- **A bounded residue:** a second leaf only partly over the first (`c` between 1 and 2), the common overlap. The emission's luminance stays within about a tenth of the supersampled truth; the blue channel, where leaves are deepest, departs most ([`../evidence/measurements.md#leaf`](../evidence/measurements.md#leaf)).
- **Outside it:** two edges inside one texel. The pair cannot tell two crossing edges from one thicker leaf, and the error can pass a factor of two at some placements. In the bake that is a texel-sized coincidence, never a layer-wide one.

**The faithful cast is on the exact side.** Its stamp is one leaf at a time, which passes `(1 − cf) + cf·e^(−τ̄ − k)` with `cf` the leaf's coverage times its fade, and the multiplicative blend then stacks leaves exactly as depths add ([`canopy.md`](canopy.md), [`transport.md`](transport.md)). Because there `k` enters the bake itself, a change of `d` re-casts the faithful cast as a sun move does.

The split was first built on the slab at every reader. It was right for the leaf and wrong for its edge, and at `k > 0` the error multiplied: a cream rim round every leaf in the sky view and a dark halo round every ballistic shadow on the floor ([`../evidence/dead-ends.md#leaf`](../evidence/dead-ends.md#leaf)). The error had always been in the soft edge; the split only made it loud.

### The marginal fade in the mixture

The fade enters the mixture as the leaf's **area**, `f·cov`, in both stored numbers, never in τ̄. This matters for the beam: a ballistic shadow built on a coverage that ignored the fade would read a full leaf's `k` over the whole footprint of a leaf that is barely there, and pop to full darkness the instant the leaf exists. With the fade in both numbers, a leaf's ballistic transmittance is continuous in its fade and exactly 1 at fade 0, and any lever that scales a leaf's coverage (a grove crossfade, abscission) moves its shadow with it. **Law**, and a calm one: [`../contracts/continuity.md`](../contracts/continuity.md).

## The edge at zero diffusion

At `d = 0` there is no split, and by default the beam keeps the old reading: the depth-averaged slab, `e^(−τ)`. That soft edge is a **pre-existing approximation, named and kept**. It is Jensen-dark: an edge texel reads darker than the leaf and gap it holds.

`edge_area` is the rung that removes it (decision 33). On, every reader takes the mixture at `k = 0` too, where `T_b` is exactly `T` and the beam becomes `(1−a) + a·e^(−τ/a)`. The faithful stamp becomes the exact one-leaf mixture as well. No new physics: the same two numbers, the same reading. It brightens every leaf edge by the factor the slab was darkening it, and lifts a frame's mean level by a few percent ([`../evidence/measurements.md#leaf`](../evidence/measurements.md#leaf)). That is a change of look, so it is José's to take, and it ships **off**.
It is a **boolean**, because a blend of two readings of one texel is a transmittance no texel has. It is **one knob for every reader**: the cast taps, the faithful stamp, the sky view's ray and the fill all read one texel by one rule. It is inert above `d = 0`, where the split already reads the mixture. The litter, which is already a coverage mixture, is unaffected.

## The gates

- **`leaf_diffuse` 0** is `k = 0`: no split, the beam is the slab (or the mixture, with `edge_area`), the fill's leaf emission and the sky view's lantern do not run, and the authored scatter proxies they retire run as before. Off, the picture is unchanged ([`../contracts/preservation.md`](../contracts/preservation.md)). Above 0 the split is a live, continuous quantity that tweens with a transition (MORPH class); it retires the authored glow proxies `fill_scatter` and `sky_scatter`, which stood in for exactly this light and would count it twice ([`fill.md`](fill.md), [`sky-view.md`](sky-view.md)). Crossing zero is the one step where a proxy switches; [`transitions.md`](transitions.md) fades it. It is a quality rung only an author crosses ([`../contracts/gates-and-rungs.md`](../contracts/gates-and-rungs.md)).
- **`edge_area` false** is the slab at `d = 0`. It flips and never morphs (TOPO class): it moves every soft edge at once, so a transition snaps it under the bloom.
- **The sieve** has no gate of its own: a leaf that has not begun to turn is one tissue and carries its authored depth unchanged, whatever `wall_fraction` says. Its gate is the season's ([`season.md`](season.md)).

Several looks open the split on purpose: montebello and its rain and cherry-blossom siblings at `d = 0.5`, the blend of glass, and the yellow tree at `d = 0`, coloured dapples by choice. That intent is recorded in [`../contracts/looks.md`](../contracts/looks.md); `0.5` is authored, not the physical 0.95.

## The outline, grown from its veins

The blade and its veins develop together, so **a maple's lobes are the negative space between its primary veins**, exactly as the canopy's gaps are the negative space between its twigs ([`../principles.md`](../principles.md), §9). The outline is grown, never drawn.

The default leaf is the **ellipse**, the stamp the piece always had. A look may instead name a grown outline (`leaf_shape`: `'maple'`, palmate, or `'beech'`, pinnate). Each grammar grows a vein skeleton in the plane, builds the blade around it, and cuts the blade as a radial profile.

### The maple

The sugar maple, as José's thirteen photographed leaves show it ([`../evidence/observations.md`](../evidence/observations.md)):

- **Five primaries from one hub**, at −95°, −43°, 0°, 43° and 95° (each ±4°), of lengths 0.36, 0.85, 1, 0.85 and 0.36 relative to the central vein (each ±10%). Three main lobes, laterals at ±43°, and a basal pair of short stubs that are a small lobe on some leaves and a shoulder on the rest.
- **A lamina round each primary** that keeps its width, 0.21 of the vein's length, over the first 0.6 of the vein and then thins to the tip, with none over the first 12% (the hub). Holding the width and then thinning is what lets a wide lobe and a deep sinus stand side by side; a linear taper cannot give both, because a cone wide enough for the tip fills the sinus beside it.
- **Alternate secondaries** every 0.18 along each primary, each ending at the margin in a 2% tooth.
- **The base.** The petiole inserts in a sinus: the blade is cut behind the curve `x = −B(y)`, `B(y) = back + sag·max(−¼, 1 − (y/bow)²) − notch·e^(−|y|/notchW)` (back 0.035, sag 0.035, bow 0.42, notch 0.06, notchW 0.07), so beside the petiole it sags back, it rounds into the basal lobes, and a V notch comes forward at the petiole. Each backward ray is cut where it first leaves that region, after the teeth and before the area is normalised, so the profile is still a radial function from the petiole base. It replaced a straight half-plane cut on 2026-11-09, matched to José's photographs DSC_0618 and DSC_0622 (José). It is about one bake texel wide at the looks' framing; it shows where an outline is seen whole: the held leaf, the litter close up, the sky view.

The angles and lengths are **calibrated** to those thirteen leaves, measured as the engine's own are; the calibration tables and the reading that produced them are evidence ([`../evidence/measurements.md#leaf`](../evidence/measurements.md#leaf)). The first maple was a five-pointed star calibrated on other leaves, and nothing like his ([`../evidence/dead-ends.md#leaf`](../evidence/dead-ends.md#leaf)). Its lesson stands as a rule: read the measure on the leaves a shape claims to be, with the same code, before writing the bands that hold it.

The grammar grows neither sub-lobes nor acuminate tips; what is left between the engine's maple and José's lies in the basal region (his most variable) and in those.

### The beech

A beech has one midrib, and its secondaries leave it **along its length**, which a fan from a hub cannot grow. It has its own grammar.

- **The lamina** is a disc every 0.01 along the midrib, of radius `W·s^a(1−s)^c`, normalised to peak at `W` (0.30): a round base (`a` 0.55), the blade widest at `a/(a+c)` of the way along, a long taper to a point (`c` 1.25). Each disc's centre is offset across the midrib by a share of its own radius (±0.06), so the base is oblique.
- **Secondaries**, 9 to 13 a side, alternate and half a step out of phase, leave the midrib forward at 45° ± 4° and run until they leave the lamina, each ending in a 2% tooth.
- **Each leaf's draws** vary its length (±6%), `W` (±10%), `a` (±0.10), `c` (±0.15), its asymmetry, its count of secondaries, and each secondary's position and angle. The disc radius does not scale with the length, so the length is a draw of the leaf's aspect: area normalisation takes away the scale, not the proportion. Beech leaves are more alike than maples, as beeches are.
- **The origin is on the midrib**, 0.45 of the way along it, the point the beech blade is star-shaped from. A beech hangs from the middle of its blade, as the ellipse does; a maple hangs from its base.

No look and no species bundle names the beech; it is a choice in the editor. A bundle waits for the mixed grove.

### The radial profile

The blade is the union of its laminae, and its **outline is a radial profile r(θ) from the leaf's origin**: the petiole base for a maple, the point on the midrib for a beech. That origin is the one point the blade is star-shaped from (it is not, in general, star-shaped from its centroid). **Approximation:** a radial profile holds exactly the blades that have such a point, and no others. The red oak, a midrib with deep sinuses between its lobes, is star-shaped from no point and cannot be held this way.

Each species has **eight variants**, each grown from its own stream. A leaf's variant is a pure function of its address (seed, cluster, leaf), on a stream of its own and never the growth stream, so a fallen leaf keeps its shape and a leaf keeps its outline as the grove's density morphs ([`../contracts/determinism.md`](../contracts/determinism.md)).

### Area normalisation

**Law.** Every profile is normalised to `∮ ½ r² dθ = π`, the area of the unit ellipse in the leaf's frame. A lobed leaf stamps the same leaf area as the ellipse it replaces, and the canopy's fullness does not move when its outline changes. The stamp's soft ramp loses a little more area across a steep flank than across an ellipse's, and keeps a little more where the profile varies, so the stamped coverage of an outline sits within a few percent of the ellipse's ([`../evidence/measurements.md#leaf`](../evidence/measurements.md#leaf)).

### The aspect law

**An outline takes the look's leaf area, never its aspect.** An ellipse's aspect (`leaf_aspect`) is its shape. An outline has its own width-to-length, grown from its veins; squashing it by the look's aspect made a maple thinner than any real one (José, of his ultraviolet maple: *"it looked so thin and weird"*). What the aspect means for an outline is its **area**: for a leaf of size `s` and aspect α, the outline's two half-axes are both

> `A = B0 = s/(2√α)`, so `π·A·B0 = π·s²/(4α)`

the area the ellipse of that size and aspect had. **Law.** The canopy is as full as the look had it, and a maple at aspect 1.75 is a *smaller* maple, never a thin one. At aspect 1 the outline is the size it always was. The aspect stays a live knob for an outline because it sets the area.

The tilt's foreshortening stays: a leaf that rocks about its midrib narrows toward a trident for a moment, and that is physics. The litter lies at the same half-axes, and the held leaf grows its maze at the same scale, so the canopy, the carpet and the inset show one leaf. The rejected alternatives (setting aspect 1 on choosing an outline; keeping the stretch) are in [`../evidence/dead-ends.md#leaf`](../evidence/dead-ends.md#leaf).

### What the stamp reads of the outline

One reading of the outline serves the layer bake, the faithful stamp and the litter carpet, so the three cannot disagree.

- **The mask measures distance outside the profile**, `|l| − r(θ)`, where the ellipse measures `|l|`. The soft edge keeps its width at a tip and in a sinus; a ratio `|l|/r` would double it at a tip. Across a steep flank the ramp is somewhat narrower, which is fine: the bake's edge is a penumbra.
- **Half the hanging leaves are turned a half turn** past the grove's angle, by another pure hash of the leaf's address. The grove draws orientations on a half circle, which is every orientation an ellipse has but only half of a lobed blade's; without the flip every tip would point into one half-plane. The ellipse keeps its angles.
- **The stamp is placed by the outline's origin**: a maple by its base, a beech by the middle of its blade.
- **Each grove carries its own outlines**, because a crossfade bakes two groves, which may differ, in one pass.

### What reaches the surface

**Only the outline and the variant**, the same rule as the texel's mixture: veins and the areole maze stay mean-only (the sieve), and the 2% teeth are below a texel on every shipped bake; they are kept as process and never tuned for. A lobe of a few centimetres blurs out of the floor's dapples for leaves more than a metre or two up, since the floor blurs everything finer than height times the sun's angular size ([`transport.md`](transport.md)). Lobes read on the litter, where a fallen leaf lies at height zero in its own outline, and looking up through a fine enough bake. On a coarse bake a 16 cm blade is a handful of texels: a soft modulation, not yet a maple.

### The gate and the species picker

`leaf_shape` defaults to the ellipse; with it, the stamp is the old one. A different outline is a different set of profiles and cannot interpolate, so the key flips (TOPO) and a transition dissolves it. No shipped look names an outline.

The species picker carries the shape: its maple sets the maple outline at aspect 1 and a leaf size of 0.103 m, the area the old bundle had at the default aspect. Every other bundle carries the ellipse. Picking back from the maple to another species keeps aspect 1, because the other bundles do not carry it.

## Leaf variety

*"We need much more leaf diversity, more species and more variability within species … they all look the same to me."* (José.) Two causes: the mean was wrong (the star), and the spread was narrow on the axes the eye reads. Jittering vein angles and lengths only moves a finger of the same leaf, and nothing differed between trees.

Form is heritable, and a crown's leaves look alike. So `leaf_variety` (v, 0 to 1.5) works at **three levels**, each a pure function of (seed, address) on a stream of its own, none drawn from the growth, arrangement or wind streams ([`../contracts/determinism.md`](../contracts/determinism.md)).

- **The tree, its genotype.** Each tree draws a genotype (one of eight) from the same per-tree stream that gives it its season lead and its pigment depth ([`season.md`](season.md)), after those draws, so they keep their values. An individual holds its clock, its red and its leaf form in one place. It is the same at any tree count, the marginal tree's included, and two trees may share one, as siblings do.
- **The family under its light.** A genotype grows **eight outlines, one per light class**, from the deepest shade (class 0) to full sun (class 7): 64 outlines a grove where a species without variety has eight. Each outline moves the species' numbers by the genotype's draws and the leaf's own, scaled by v: the lateral angle (±5° by genotype, ±5° by leaf), the basal length (±0.15, ±0.12), the lobe breadth (±0.025, ±0.02), the lateral length (±0.07, ±0.06), and the basal angle (±10°, the leaf's alone). The same grown outline serves the stamp and the held leaf.
- **The sun cuts deeper.** The lobe breadth falls by `0.04·v·λ`, with `λ = (c + ½)/8 − ½` running from −7/16 in the shade to +7/16 in the sun. **Provisional:** a more deeply lobed sun leaf is classic in the oaks and an extrapolation for a maple or a beech, whose documented sun leaf is smaller and thicker; the magnitude is not measured, and the default is conservative. **The beech's bundle** (2026-11-09, José): a genotype draw and then a leaf draw each move its width W (±0.03, ±0.02), the base's roundness (±0.08, ±0.05) and the taper (±0.12, ±0.08), scaled by v, and the sun narrows the blade by `BEECH_LIGHT·v·λ` (0.057: the maple's sun cut as the same share of the beech's width, about ±8% at v 1). **Provisional**, unmeasured, like the maple's.

### The leaf under its light

A leaf hangs in its tree's genotype, in the light class

> `c = 8u + 2(h − ½) − ½`, clamped to 0…7

where `u` is the leaf's rank of light in the grove and `h` its own variant draw, which blurs the class by a column either way. **The class is continuous:** a leaf at a whole class hangs that class's outline, and a leaf between two hangs a blend of the two, their radial profiles mixed by the fraction, so a leaf whose rank moves changes its lobes by degrees. The carpet and the held leaf take the nearest class, `floor(8u + 2(h − ½))`. The light is **the grove's own exposure rank on the summer set**, the same rank that reddens the sun side of a tree: one light, two consequences ([`season.md`](season.md)). It is the rank and never the season's blend of rank and absolute light, because shape is not season.

**The size shift.** A leaf's size is multiplied by `m = 1 + 0.15·v·(1 − 2u)`: smaller in the sun, larger in the shade. It is continuous in the rank, not stepped by the class, so a size never pops. The grove is renormalised once by

> `κ_size = √(Σ cov·A·B0 / Σ cov·m²·A·B0)`

cover-weighted so the marginal leaf and tree count as much as they are present, so the canopy's total leaf area is the look's and the canopy is as full as it was. **Law** in intent.

**Variety moves no leaf's colour, no leaf's day and no order of fall.** The light is computed from the leaves' areas before any size shift, and the season reads the same pre-shift areas, so the season at any variety is the season at none ([`season.md`](season.md)).

**It is not a pure function of the leaf's address, and that is said.** The class comes from the grove's exposure rank, a function of the whole grove. At v > 0 a canopy morph (density, tree count, a macro) re-ranks the light, and a leaf's rank moves and its lobes move with it, by the blend between two classes, never by a step and never in its size. Decided 2026-11-09 against the swap the floored class gave: over a density morph on park 1 as a maple, frames with a jump fell from 197 of 240 to 1, and that one is not a swap ([`../evidence/observations.md`](../evidence/observations.md); the measured size of the old swap is in [`../evidence/measurements.md#leaf`](../evidence/measurements.md#leaf)).

### The gate, and what 1 is

`leaf_variety` 0 is eight outlines a species, the same on every tree, and the picture is unchanged. It flips (TOPO), beside `leaf_shape`: a new set of outlines and a new outline per leaf cannot interpolate, so the step from 0 re-deals every outline once and the crossfade dissolves it. It is part of the grove's identity and never of the season set. The ellipse never varies. No shipped look opens it. Variety also lifts the grove's build cost, since its pass needs the exposure field a summer grove otherwise does without; that cost is a named one ([`../contracts/gates-and-rungs.md`](../contracts/gates-and-rungs.md)).

**1 is reality.** At `leaf_variety` 1 two outlines of a grove are about as far apart as two of José's thirteen, read on the whole outline: the spreads above are read through `VARIETY_REAL` = 1.5, the point on their own scale where they reach his spread (at their own 1, where they were calibrated and every outline keeps a central lobe flanked by two, they were three quarters of it). Above 1 the leaves are more varied than nature, on purpose, and an occasional outline loses its central lobe. Decided 2026-11-10.

## The held leaf

José, holding a maple leaf to the sun: *"it looks like a maze… cells with white walls in between… like lizard skin. the colour i dig too, the darkening of it."*

The engine carries that maze only as a mean, the sieve, and must stay so: the feeling at no cost to the frame. So the maze has a proof bench of its own, an editor fixture (`L`): one grown leaf of the grove held against a white sun, its areole maze at full resolution, walls gold and cells red. It belongs to the editor alone; no look, no parameter and no bundle carries it ([`../implementation.md`](../implementation.md)). Being on demand, it may draw what the engine may not.

**It is a real leaf of the grove.** It shows leaf (j, k) of the grove on screen, with that leaf's outline variant, its light class and genotype when variety is on, and the very vein skeleton its outline was cut from, so its veins are its outline's veins. It reads all of this off the grove the engine holds, never off the parameters, which can run ahead of the picture. It sits on a tree, the one the grove hangs its cluster on, and takes that tree's lead and depth ([`season.md`](season.md#one-tree-ahead-of-its-neighbours)), so it recolours with the per-tree knobs as it does with the pigments. When the look has no outline it shows the maple, and says the engine draws the ellipse.

**The maze is successive domain division**, seeded by those veins. Order 1, the primaries, cut the margin: a maple's five into radial sectors, a beech's midrib as one chord through the origin to the margin, which splits the blade into its two sides. Order 2, each secondary, runs along its direction to the first wall of the region it is in, ending in a T-junction. From order 3, any region larger than an areole (about a millimetre) is cut by a chord across its principal axis, turned partway toward square with the two sides it lands on, until every cell is about a millimetre. **Not Voronoi:** Voronoi gives 120° Y-junctions and no hierarchy, where a leaf's veins meet near right angles and the older ones are the wider.

**The walls carry exactly the wall fraction.** Each wall has a half-width in proportion to its order, solved so that the walls hold `f_w` of the lamina, so the picture's mean transmittance *is* the engine's sieve mixture, and the sieve reads literally. **The tissues come from the pigment law itself**, the cell at the leaf's own clock and the wall with its anthocyanin removed ([`season.md`](season.md)); nothing is restated. The canopy's exposure order cannot be known to a leaf held in the hand, so the held leaf has none, and says so.

## Approximations and limits

- **The texel holds one representative leaf and a gap.** *Approximation.* Exact for one leaf and for leaves stacked over the whole texel; a bounded residue for a partial overlap; blind to two edges in one texel. Absent where the faithful stamp draws one leaf at a time.
- **The depth-averaged soft edge at `d = 0`.** *Approximation, kept by default*: Jensen-dark at every leaf edge. Absent with `edge_area` on, or with the split open.
- **Single scatter.** *Approximation.* A leaf's diffuse light goes down through the layers below on their true transmittance; none of it glows sideways out of the leaves beside it, and none bounces.
- **The ballistic residue carries the leaf's hue.** *Approximation, and visible:* at `d` 0.95 it is five percent of the light, so a faint coloured sun-image of each leaf remains; a stack of three is gone.- **The uniform-sky identity is first order.** *Approximation*: diffuse equals ballistic transmission only for a uniform sky through Lambertian leaves, which is why the skylight is not split.
- **`d` is one number for every leaf.** *Authored* in a look; physically about 0.95.
- **The sieve is a mean**, with no vein geometry; overlapping leaves multiply independent means. *Approximation.*
- **The radial profile** holds only blades star-shaped from one point. *Approximation*; it excludes the oak.
- **Eight variants a species, 64 with variety.** *Approximation*: outlines are classes, not one per leaf.
- **The sun's deeper cut** is extrapolated from the oaks and unmeasured for maple and beech. *Provisional.*
- **Teeth, veins, sub-lobes and acuminate tips** do not reach the surface; the grammars grow no sub-lobes or acuminate tips at all. *Approximation.*
- **The held leaf.** *Approximation.* Primaries and secondaries read dark in the photograph (thick tissue) and bright here like every wall; cells darken toward their centres in the photograph, and here there are two tissues only; there is no exposure order; the wall-width multipliers by order (4, 3, 2, 1.5, 1) are *Provisional*.

## Not built

See [`../exploration/open.md`](../exploration/open.md).

- **The red oak**, whose outline no radial profile can hold, and the patchy turn. `leaf_shape 'oak'` is still the ellipse.
- **The mixed grove**: species per tree, with the beech in a bundle.
- **A thickness term on the wall's depth**, so that large veins read dark as in the photograph.
- **Blemishes** on the held leaf (browning from the margin, tar spot, leaf spot with halo, insect holes): a hook with nothing in it.
- **A spring half** of the leaf's colour (the season's; [`season.md`](season.md)).

## Related

- [`canopy.md`](canopy.md): where leaves hang, how they are binned and baked into layers, the faithful cast, why marginal leaves fade.
- [`season.md`](season.md): the pigment state that sets τ_cell and τ_wall, the exposure rank, abscission, the litter as a floor material.
- [`transport.md`](transport.md): how the beam reads `T_b` through every layer.
- [`fill.md`](fill.md): how `T` and `T − T_b` light the shade.
- [`sky-view.md`](sky-view.md): the leaf as lantern, read from the same two numbers.
- [`../contracts/preservation.md`](../contracts/preservation.md), [`../contracts/determinism.md`](../contracts/determinism.md), [`../contracts/continuity.md`](../contracts/continuity.md), [`../contracts/looks.md`](../contracts/looks.md).
- [`../evidence/dead-ends.md#leaf`](../evidence/dead-ends.md#leaf): the slab reading, the star, the mitten, the rejected aspect fixes, the rejected variety designs.
- [`../evidence/measurements.md#leaf`](../evidence/measurements.md#leaf): the maple calibration against José's thirteen, the beech's measures, the mixture's error bounds, the edge law's effect on the shipped looks, variety's spread and cost.
- [`../evidence/observations.md`](../evidence/observations.md): the held maple, the thirteen photographs, José's words.
