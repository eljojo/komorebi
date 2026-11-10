# Receivers

*The surface the light lands on: the floor, the curtain, the tent, and the one interface they share.*

Everything upstream of here ends at one quantity. Transport builds `acc`, the dimensionless fraction of the sun's disk that cleared every occluder at a point: the **landed irradiance**. A receiver is what answers it. It takes the arriving irradiance and the surface's geometry and returns the radiance toward the eye. The floor reflects; the curtain and the tent transmit through dyed cloth; the retina, looking up, has no surface at all and is described in [`sky-view.md`](sky-view.md).

## The interface

**Geometry up, material down.** A receiver's *geometry* (its plane, its normal, its pleats, its panels) feeds **up** into transport: it sets where a shadow projects and which surface a ray meets. Its *material* (transmission, dye, scatter, weave, pile) flows **down** from the landed `acc`. The two never trade places. Occluder and receiver share one geometry, or the shadow comes apart from what casts it.

**A surface is an addition, never an edit** ([`principles.md`](../principles.md) §10). The gate is `receiver`: 0 the floor, 1 the curtain, 2 the enclosure. Off, which is 0, every look is the floor it always was. Each receiver is its own camera in the transport registry ([`transport.md`](transport.md)); a material rides its camera, and a pair that does not exist (a tent whose mesh panels read as sky) is **Not built** (below).

**Switching receivers is a change of scene, not a morph.** `receiver` swaps the whole camera mapping (floor ray-cast, head-on cloth map, enclosure ray-cast) and, at 2, the occluder tier, so a transition across it rebuilds under a passing cloud. The shape knobs inside one receiver are live and tween. See [`transitions.md`](transitions.md).

## The floor

The floor is an opaque diffuse surface reflecting the landed light off an albedo:

> floor colour = (acc·sunColor + ambient) · ground

`ground` is the floor albedo (`ground_r`, `ground_g`, `ground_b`), white by default, a warm dirt-brown on the looks that want their shade to read as earth so that only the hottest dapples burn back toward white. **Law** in form, **Authored** in value.

What the floor reads beyond that line belongs elsewhere. Its beam takes the cosine of its incidence, `sin el`, under `sun_cosine` ([`light.md`](light.md)). Its `ambient` becomes the canopy-filtered sky plus the light the leaves scatter down when `canopy_fill` opens ([`fill.md`](fill.md)). Its albedo becomes a carpet of fallen leaves when `litter` opens ([`season.md`](season.md)); only the floor reads the litter. The floor is the reference every other receiver collapses to in its untilted, undyed case.

## The curtain

The bedroom curtain is sunset through a backyard tree onto a moss-green velvet drape, seen from the bed ([`experience.md`](../experience.md)). A translucent woven screen does not reflect the landed light; it transmits it, lit from behind. Everything below follows from taking that seriously.

### The transmission

The fabric answers the landed irradiance by transmitting it through dyed pile. What keeps a dark velvet from reading as a bright coloured gel is a clean split: **total throughput `Tt ∈ [0,1]` carries brightness; the dye carries only hue.** The dye is normalised to unit peak, `tint̂ = tint / max-channel`, the same "normalise to hue, let a separate factor carry level" idiom the atmosphere and the leaf's chlorophyll spectrum use. So

> curtain colour = (acc·sunColor + ambient) · (Tt · tint̂)

is the structural twin of the floor, with a transmittance `Tt·tint̂` standing where the albedo stood. **Law.** It is energy-bounded, since `Tt·tint̂ ≤ 1` and the transmit can never out-glow the light that landed; and it collapses exactly onto the floor when `Tt·tint̂` equals the floor's albedo.

**The ambient is single-counted.** The skylight is part of the landed irradiance and passes through `Tt·tint̂` once, like the beam: the sky that leaks through a backlit curtain is itself attenuated and dyed by the cloth. Adding it a second time (`… + ambient·Tt`) double-counts the sky and breaks both the energy bound and the collapse to the floor. **Law.** See [`../evidence/dead-ends.md#receivers`](../evidence/dead-ends.md#receivers).

With a warm low sun, gap light reads warm-gold, the dye under a low `Tt` a dim olive body glow, and the deep shade, where only sky leaks through, cool green-black: "the suns stay white-gold, the shade goes dim green", moved onto the cloth.

The knobs: `fabric_tt` is `Tt`, the brightness, from sheer to terciopelo; `fabric_tint_rgb` is the dye, hue only.

### The standing plane

The curtain is a vertical receiver, and transport's receiver-relative read ([`transport.md`](transport.md)) generalises to it for almost nothing: on the cloth the receiver's height is the height **up the cloth**, so the tree's dapples and its trunk and limb streaks stand up the plane instead of lying on the ground.

The camera, in curtain mode, is a head-on view of that plane: screen maps to the cloth's own `u` across and `v` up through one isotropic scale,

> cloth = (uv − ½) · view_extent_m · (aspect, 1)

so the frame is cloth. The plane stands at world distance `cloth_distance_m` behind the tree. The bulk sun-throw of the standing scene is what rakes the projection: a low sun is what makes the shadow climb the cloth, and the plane's distance plus the sun's angle place where it lands.

**The faithful cast re-aims at the cloth.** The pre-integrated cast of the real geometry ([`canopy.md`](canopy.md)) projects leaves and wood into cloth coordinates rather than floor coordinates, along the throw `g` with cloth-facing component `gy`:

> u = px − r·gx,  v = h − r,  with  r = (py − cy)/gy

and its frame is bounded by sweeping the grove's plan extent at every height through that map. This is the curtain's faithful path. The layer path generalises through the same height-minus-receiver read and is the cheaper fallback tier, with one **Approximation**: there the analytic woody occluder's distance on the cloth is measured partly in plan depth rather than up the cloth, so the wood's penumbra on the curtain is approximate.

### Both regimes in one frame

On the curtain the crossover between the shape regime and the sun-image regime reappears with **receiver distance `d` in place of canopy height** ([`transport.md`](transport.md), [`source.md`](source.md)). A feature is in the shape regime when its aperture `a ≫ d·θ` and in the pinhole regime when `a ≪ d·θ`. The window's 30–40 cm panes, a few centimetres off the cloth, are deep in the shape regime: you see the grid, sharp. The tree's leaf-gaps, metres away, are pinholes: soft images of the sun. Same sun, same frame, opposite regimes, set purely by distance. This is the curtain's defining image, and it needs no new transport. **Law.**

### The pleat field

A flat cloth reads as a screen, not a curtain, so the receiver hangs in pleats. Every consumer of them reads **one** displacement function of the cloth coordinate, which returns the out-of-plane shape and its `u`-derivative together.

Gravity writes the first rule. Cloth hangs; a pleat runs down the drape parallel to the pull; nothing about a heavier hem makes it lean. So the phase of every harmonic is a function of `u` **alone**, and the ridges are exactly vertical at every height. **Law.**

> `Δy(u,v) = fold_warp · Σᵢ wᵢ(v)·aᵢ·sin(kᵢ·u·2π + φᵢ) / Σᵢ wᵢ(v)·aᵢ`,  with  `kᵢ = fold_scale · (1, 1/φ, 1/(1+√2))`

Three harmonics at pairwise irrational ratios, the golden and silver means against the fundamental. Their sum is almost-periodic: it never repeats at any distance, so the drape has no wallpaper tile and no two pleats are alike. That aperiodicity needs no hash, noise or random draw, and it is infinitely smooth, which the warp's derivative and the incidence normal both require. The amplitudes go as `aᵢ ∝ 1/kᵢ`, so every harmonic contributes the same peak slope while the displacement stays dominated by the broad waves: the eye reads big soft waves carrying fine gathers, and the shading, which reads slope rather than height, gets an even share from each octave.

**Coarsening is a reweighting of the spectrum, not a chirp.** `fold_coarsen` fades the octaves against each other down the drape,

> `w = (f, 1, 2 − f)`,  `f = 1 / (1 + fold_coarsen · v)`

so the finest harmonic dies out toward the hem while the broadest grows to take its place: fine gathers at the rod melting into broad waves at the floor, ridges vertical throughout, which is what a heavy drape does. At `fold_coarsen` 0 the mixture is the same top to bottom. The `Σ wᵢaᵢ` divisor holds the peak displacement at `fold_warp` metres at every height, so the knob keeps meaning metres while the mixture underneath it changes.

*A spatially varying frequency is a statement about phase, and phase is where the geometry lives.* Coarsening by chirping one sinusoid's frequency down the drape makes every ridge (a curve of constant phase) tilt outward as it descends, by an amount proportional to its own `u`; the cloth grows a symmetric fan that reads as light on the floor of a swimming pool. Hanging cloth cannot do that. Where a feature's orientation is physically fixed, vary *which* frequencies are present and never the frequency itself. **Law.** The failed attempt is in [`../evidence/dead-ends.md#receivers`](../evidence/dead-ends.md#receivers).

`fold_scale` is the pleat count, `fold_coarsen` the widening toward the hem, `fold_warp` the displacement in metres, `fold_depth` the shading.

### The velvet

`fold_depth` is pile thickness painted onto the plane, and it is deliberately a different knob from `fold_warp`: one shades the cloth and the other moves it. Its driver is the field's own normalised slope,

> `facing = |dΔŷ/du| / max|dΔŷ/du|`

taken from the *unit* shape, before `fold_warp` scales it to metres, so the banding is a property of the pile and survives on a cloth with no displacement at all. 1 is an edge-on flank, 0 a face-on ridge or valley.

The shading turns a sheet into thick velvet two ways. The edge-on flanks present more backlit pile along the ray, so they transmit less, `band = e^(−fold_depth·facing)`: dark vertical bands. The face-on ridges catch a soft pale **sheen**, a desaturated warm tint of the dye laid over the dim body, the giveaway of a standing-fibre cut pile rather than a flat dyed weave (`velvet_sheen`, 0 matte). A fine **nap** ripple rides the body: it varies across `u` only, at an irrational multiple of `fold_scale` so it never locks onto a fold, at ±4 % at full pile and less as `fold_depth` falls, so a thin taut fabric is smooth, plus the fabric's own grain, `fabric_nap` (0 by default), which a taut cloth with no pile can carry: tent 1's nylon takes 0.04. A ripple varying in `v` would draw horizontal stripes; past about ±5 % a grain reads as engraving. There is no flat warp-and-weft texture: a thin woven grid reads as canvas, not velvet. **Authored.**

### The forward-scatter wrap

Backlit cut pile transmits by two routes. The **ballistic** share threads the pile directly; it is highly directional, so an edge-on flank, several times more fibre along the ray, extinguishes it, and that is the `fold_depth` band. The rest **forward-scatters**: it diffuses among the fibres and leaves the back face in a broad lobe, near-isotropic, so which way the flank turns barely attenuates it. `fabric_scatter = s ∈ [0,1]` is the share of the transmitted light that takes the second route, and it enters as a **split of the same energy, never an add**:

> body · mix(band, bandSoft, s) · nap + sheen,  with  band = e^(−fold_depth·facing),  bandSoft = e^(−fold_depth·facing·0.25)

The scattered share walks the same Beer path at a quarter of the weight: it still dims edge-on, since there is still more pile to cross, but it never goes black, so the body glow **wraps** into the dark flanks and the cloth reads as lit from within rather than as a stencil. The 0.25 is **Authored** ("mostly, not wholly, orientation-blind"), not measured: 0 would flatten the scattered glow entirely and 1 would collapse it onto the ballistic band.

The energy bound holds by construction. Both bands are at most 1, so their mix is, so `Tt·tint̂·mix ≤ 1` still forbids the cloth to out-glow what landed on it; that is why the term is a mix and not the tempting `+ s·glow`. The dye is not doubled: the scattered light crossed the same dyed pile, so its hue is `tint̂` and there is no second scatter tint. At `s` 0 the shading is the ballistic band alone.

**What the wrap cannot do.** Reading no neighbours, it redistributes light *angularly at one point*: it softens the fold shading, which is per-pixel, and that is why it is free. It **cannot** carry a dapple's glow across its own cast-shadow edge; that is a *lateral* transport between cloth points, the lateral diffusion below, at its price. Under the quality-rung contract ([`../contracts/gates-and-rungs.md`](../contracts/gates-and-rungs.md)) the diffusion degrades to this wrap, and the wrap to `s` 0.

### The window mullion grid

The grid is the **authored** occluder, the inverse of the grown canopy, and it supplies the near half of "both regimes in one frame": a rigid lattice of vertical and horizontal bars at pitch `mullion_pitch_m` (the pane), width `mullion_bar_m`, standing `mullion_depth_m` in **front** of the cloth on the sun side. It is evaluated analytically per pixel in cloth coordinates, the near-contact sibling of the woody occluder ([`canopy.md`](canopy.md)): a few operations, no texture, no geometry, nothing regrown. Its gate is `mullion_tau`, the bars' optical depth; at 0 there is no window grid.

**The grid is never stamped into a depth layer.** On the faithful path the layer loop never runs, so a stamped grid would vanish in exactly the looks that need it, and on the layer path height quantisation shatters continuous lines at a low sun. An occluder in **receiver coordinates** is applied after transport, where both tiers have collapsed to one `acc`, so it runs the same on either. **Law** of the design. See [`../evidence/dead-ends.md#receivers`](../evidence/dead-ends.md#receivers).

**Throw: the grid rakes with the sun.** The bar plane sits `d = mullion_depth_m` in front of the cloth, so along the central ray it drops `r = d/gy` to reach the cloth. Inverting the cloth projection above to ask which bar point shadows a given cloth point gives

> bar point = (u, v) + (d/gy) · (gx, 1)

one vector up-sun. A bar's shadow slides the way the trunk's does as the sun moves, only far less, which sells the bars as standing in front of the cloth rather than printed on it. One central ray is used rather than an integration over the disk: at centimetre depths the spread is sub-millimetre, and the penumbra term stands in for it. **Approximation.**

**Penumbra: depth times the source, and nothing else.** The soft edge is

> mullion_depth_m × (core angular radius · (1 + 3·cloud_thickness))

the source's own widened radius ([`source.md`](source.md)) times the depth, the woody occluder's penumbra without its `1/sin(elevation)` factor. That factor is the ground's obliquity, and the cloth is seen head-on. A clear sun draws the grid crisp; drifting cloud softens it through the same widened source that softens everything else.

**A near occluder takes the beam and the sky.** The woody occluder multiplies `acc` alone: wood metres away blocks only the sun's small disk, and the skylight reaches around it. A bar centimetres off the cloth subtends nearly the whole hemisphere seen from the point behind it, so it takes both. The mullion transmittance `exp(−τ·coverage)` multiplies the **whole landed irradiance** `E = acc·sunColor + ambient`, before the fabric answers it. That is why the shaded panes read as genuinely dark rather than merely unsunlit. **Law.**

### The window aperture

Without an aperture the light behind the cloth is infinite: a lit field with no boundary, tiled edge to edge by bars, monotone because nothing in the frame is wall. The remembered room is a **finite bright rectangle** of sky and a dark room around it; that one contrast is most of the composition, and every subtlety the receiver models is legible only against it. So the window has an aperture, `window_w_m` × `window_h_m`, centred at (`window_cx_m`, `window_cy_m`) in the cloth's coordinates (the centre is, in effect, the sill height).

The aperture is the window's outermost frame member, so it lives at the **bars' plane**, takes their throw and penumbra, and is read at the **same warped coordinate**: frame and bars soften together as cloud thickens, and **the frame's edge S-bends across the pleats exactly as the bars do**.

> `mask = window_wall + (1 − window_wall) · insideRect(castUV + (d/gy)·(gx, 1))`,  `E ← E · mask`

It multiplies the whole landed irradiance, beam and sky alike, for the same near-contact reason as the bars: a wall centimetres off the cloth shuts out the sky as thoroughly as the sun. The grid is **confined** to the aperture, its coverage scaled by the same inside-rectangle factor: the bars belong to the window, and a wall has no glazing.

**`window_wall` is the one deliberately non-physical term.** The wall is opaque, so strictly nothing lands outside the aperture, but the room the viewer lies in has its own dim light on the near side of the cloth, and this stands in for it at a few percent. At 0 the surround is a black void; at a few hundredths it is dark cloth whose folds you can just make out. **Authored**, not an approximation of light through masonry.

Either dimension at 0 is the gate: an infinite lit field, and the grid unconfined.

### The fold warp

`fold_warp` makes the pleats geometry. A pleated cloth point does not sit on the plane every occluder read is built against; it stands `Δy` out of it, so it intercepts a different ray, and what lands on it is the flat cast read at a **shifted coordinate**. The shift is not a new derivation. Displacing the receiver by `Δy` in the cloth projection changes `r` by `Δy/gy`, which is exactly the mullion throw with the pleat displacement standing in for the bar depth:

> `castUV = clothUV + (Δy/gy) · (gx, 1)`

`Δy > 0` bulges the pleat **toward the room**, so the flat cast plane sits in front of the displaced point exactly as the bars do.

**The shared phase is a requirement.** The velvet's `facing` is the normalised magnitude of that same field's derivative, so it peaks where `Δy` is steepest, and the bend lands on the fold **flanks**, the tilted parts, the only places a displacement should bend anything. One function returns `(Δŷ, dΔŷ/du)`, evaluated once per pixel and read by both, so the bend cannot drift off the folds it bends over: there is no second copy. **Law.**

**What warps, and what does not.** `castUV` replaces the cloth coordinate everywhere the **arriving** light is sampled: the faithful tap; the layer tier's read, carried as plan position and receiver height (the layer maps are plan-space, so sliding the receiver point along its own ray is exact there, and the analytic wood follows because it reads the same two); and the mullion grid, where the composition is right by construction (a displaced pleat sees the bars at depth `d + Δy`). What stays unwarped is the **shading** coordinate: the pleats are attached to the cloth, so the velvet reads the cloth's own coordinate.

At `fold_warp` 0 the cloth is flat.

### The fold incidence

A tilted flank is lit by how squarely it meets the sun, and that incidence cosine is the one piece of curtain geometry the throw vectors cannot supply. They are rates per unit height, carrying `1/sin(elevation)` and floored near the horizon, while incidence on a vertical cloth, `cos el·|sin az|`, **peaks** as the sun lowers toward the window; reusing them would dim the folds at the very sunset the look is built for. So the curtain uses a **unit sun direction**,

> sunDir = (cos el·cos az, cos el·sin az, sin el)

unclamped in elevation, the one sun vector here that is a direction rather than a rate.

The flank normal comes from the **same** corrugation the warp displaces with. The field returns `dΔy/du` alongside `Δy`, differentiated term by term:

> `dΔy/du = fold_warp · Σᵢ wᵢaᵢ·kᵢ·2π·cos(kᵢu·2π + φᵢ) / Σᵢ wᵢaᵢ`

and with `Δy` toward the room, the surface `(u, cy − Δy, v)` has unit normals `±(dΔy/du, 1, 0)/‖·‖`, the sun-facing one chosen by the sign of the sun's cloth-facing component. Then

> `cosI = max(n̂_sun · sunDir, 0)`,  shading factor = `cosI / cosI_flat`

normalised so a flat cloth is exactly 1. The gate is the warp geometry itself: no tilt, no variation, no knob of its own.

Elevation **cancels** in the ratio, being common to both cosines, so what modulates the flanks is pure azimuth; a sun squarely head-on only foreshortens both flanks, and it takes an off-axis sun to band them lit and dark. The ratio **exceeds 1** on a flank turned into the sun, which is honest, since that flank collects more than the flat plane would; it diverges as the sun rakes parallel to the cloth, the degenerate pose where the cloth cast is already meaningless. That is the one place the scatter split's `≤ 1` bound is **re-based rather than broken**: the split still divides one fixed transmitted energy, and the incidence corrects the irradiance being divided, which was only ever the flat plane's.

It is **relative** to the flat cloth. The flat cloth's own incidence, `cos el·|sin az|` (`|sunDir.y|`), is the absolute factor and arrives with the sun's colour under `sun_cosine` ([`light.md`](light.md)), so a flank collects its ratio of the flat cloth's share and nothing is multiplied twice.

It multiplies the **ballistic** share only. The scattered share leaves the pile in a broad lobe after bouncing among the fibres, so which way the flank turns barely changes it, while the ballistic share is directional by definition. And it lands **on top of** `fold_depth`, not in place of it: the band is pile thickness, this is orientation, two knobs for two authorial roles.

### The lateral diffusion

The wrap redistributes light angularly at a point; this spreads it spatially between points. It is the same forward scattering read one scale coarser: a photon entering the weave inside a hot dapple bounces among the fibres and leaves the back face a centimetre away, so a bright patch lends part of itself to the dark cloth beside it. It is what makes one patch read as a hard spotlight and the next as glowing haze. `glow_bleed = d ∈ [0,1]` is again a **split, never an add**:

> `out = mix(sharp, blur(sharp), d)`,  blur = a Gaussian of radius `glow_bleed_m` metres of cloth

The energy bound is exact: a normalised kernel moves light and cannot make any, so what a hot patch loses its surround gains, and the frame's total is unchanged. **Law.** At `d` 0 there is no pass at all.

**Where the tail sits.** The blur spreads light, so it runs on linear HDR and the Look's tone tail moves past it ([`camera.md`](camera.md)); the mesopic shift and the distance haze stay upstream.

**The radius is cloth, not pixels.** Seen head-on through a linear map, screen space *is* cloth space up to one scale, so a screen-space blur is a genuine diffusion through the fabric. Pixels per metre is one number, the target's height over `view_extent_m`, so the bleed stays the same centimetres of fabric at any zoom or canvas size.

**The kernel, and where it stops being honest.** The blur is a separable Gaussian with a fixed tap budget. A wide radius would spread those taps until a hard edge came back as a row of shifted copies of itself, so the spacing is capped and a wide radius **falls short of the metres asked for** (the figures are [`../evidence/measurements.md#receivers`](../evidence/measurements.md#receivers); the kernel is [`../implementation.md`](../implementation.md)'s). A glow that stops short still reads as a glow; a combed one reads as a bug. The next rung, if reach ever matters more, is a downsampled pyramid.

**The rung.** Off, none of it exists and transport draws straight to the screen. It is a **style** rung, not a quality one: measured for its price and never cut automatically; only an author may remove it, on one look ([`../contracts/gates-and-rungs.md`](../contracts/gates-and-rungs.md)). The same pass serves the sky view as the eye's veiling glare ([`sky-view.md`](sky-view.md)).

### How the curtain reads the fill

With `canopy_fill` open the curtain's sky term is the canopy-filtered sky at the point's plan position, with its view factor kept at the floor's 1; the leaves' scattered light, when the leaf's diffuse split opens it, enters through a view factor of its own, ½, the half-hemisphere a vertical plane sees ([`fill.md`](fill.md)).

## The tent

The second reference is komorebi on the nylon of a tent pitched under trees at midday, seen from inside, lying down ([`experience.md`](../experience.md)). It is the receiver's second instance, and the proof of the interface: a second *material point* and a second *geometry*, not a second mechanism.

### The material: the curtain's, at the opposite corner

The tent runs the curtain's fabric exactly: the same transmission law, the same `Tt·tint̂` split, the same pleat field and velvet, the same scatter split and lateral diffusion. What changes is where it sits in that space. The velvet is **low `Tt`, saturated dye, pile sheen, mostly ballistic**; thin nylon is **high `Tt`, near-neutral, matte, heavily forward-scattering**. The same knobs reach both without a branch, and the near-white cloth shows what the velvet hides: the scene's green comes from the **leaves'** transmittance, not the receiver. Its folds are wrinkles: broad, shallow, barely coarsening.

The tent is where the depth blur `(h − z_p)·θ` is most legible, without a window: the **tree's own height spread** stages both regimes, branches grazing the fabric casting hard shapes beside the soft plates of the canopy metres above. It is the model's cleanest demonstration that softness is geometry, not a blur radius. The reference's spotlight-versus-haze contrast is only partly reachable through sun, cloud and grade; the rest is the lateral diffusion, which that photograph motivated.

### The enclosure

The tent photograph is taken from **inside** one. Canopy overhead, light falling onto panels that surround the viewer, and the detail that carries the whole read: *different panels at different brightnesses, because they face different ways*. A plane has one normal, so no exposure, drape or sun angle can make one wall read as being inside anything. So `receiver` 2 builds the enclosure: the first receiver whose orientation is a function of the pixel.

**The shape is a small room, not a corridor.** As the person lying in it sees it: a flat rectangular **crown** along the top; **two side walls** rising to the crown's long edges; and an **end cap** at each end that *closes* the space. An infinite ridge converges to a vanishing point; a real enclosure converges to a surface at a finite distance with an edge you can see. *A depth cue is not a boundary; only a boundary is a boundary.* **Law** of the composition. See [`../evidence/dead-ends.md#receivers`](../evidence/dead-ends.md#receivers).

**The cross-section is a bell, not a wedge.** End-on, a wide skirt rises from the base to a bulged **shoulder** at about half height, above which the wall leans back in to the narrow crown. The shoulder standing *outside* the straight base-to-crown line is what makes a modern tent feel like a room.

**Two constraints keep it from reading as a church.** Flat panels meeting at angles, with a dark rib along each meeting, is the grammar of a stone vault. First, the reference is tensioned fabric on pre-bent pole arcs: its side is a rounded arch with no crease anywhere, and the shoulder is where the arch bulges widest, not a fold. Second, once a curve is approximated by facets, every facet junction is a lie the seam pass must be told to hide: *when a smooth thing is approximated by pieces, every downstream pass that reads the pieces must be told which boundaries are the object's and which are the approximation's.* **Law.** The vault that taught it is in [`../evidence/dead-ends.md#receivers`](../evidence/dead-ends.md#receivers).

### The arches

Each side is one arch: a **quadratic Bézier** through three authored points, the base `(halfW, 0)`, the shoulder waypoint `(shoulderW, shoulderH)` hit exactly at `t = ½`, and the crown edge `(crownW, ridge)`, which pins the control point at

> `C = 2·P₁ − (P₀ + P₂)/2`

A quadratic Bézier is a parabolic arc, so its curvature cannot change sign: the curve is **convex by construction**, and the tangent planes of a convex curve are a convex set of half-spaces. That is what lets the shape round for free. Each side is sampled by four tangent planes, at `t = 0, ⅓, ⅔, 1`, the ends **included**, so the hull touches the authored base and crown edge exactly and bulges only between them, never more than a centimetre and a half outside the true arc at the shipped size ([`../evidence/measurements.md#receivers`](../evidence/measurements.md#receivers)).

The knobs: `tent_ridge_h_m` the crown height, `tent_half_w_m` half the floor width, `tent_crown_w_m` half the crown's width (0 collapses it to a ridge line), `tent_shoulder_h_m` and `tent_shoulder_w_m` the waypoint.

**Smooth normals over a coarse hull.** The shading normal on an arch is the **profile's own**, found at the hit's height by inverting the Bézier's height map, not the facet's. So the beam and sky factors and the cloth tangent round continuously across the side, the way light rounds on tensioned fabric; across a facet boundary inside one arch the normal barely moves, and across a real pole line it jumps as a dihedral should. The silhouette stays subtly faceted; the lighting, which the eye reads as roundness, does not. **Approximation.**

**The hubs need no modelling.** The corners the reference reads as hardware are simply **vertices of the polytope**, where an arch strip, the crown and a cap plane meet. They land in the right place for free, and the seam pass draws the pole lines radiating out of them without one edge being enumerated. An intersection of half-spaces derives what a mesh would have to author.

### The polytope and one min()

In tent space the long axis is +Y and the interior of each half-space is `n̂·X < c`, an outward unit normal and an offset. The tent is **fifteen** of them:

> **Crown** `(0, 0, 1)·X < ridge`
> **Arch strips**, four per side, tangent to the profile at `t = 0, ⅓, ⅔, 1`: `n̂ = (B′ᶻ, −B′ˣ)/‖·‖` through `B(t)`, mirrored to `−x` by negating `n̂.x` at the same offset
> **Each cap**, three members of one plane family (next section)

From a point **strictly inside** a convex polytope, a ray leaves through exactly one panel, so the exit is a bare

> `t = min over planes with n̂·d > 0 of (c − n̂·eye)/(n̂·d)`,  panel = the argmin

with no per-panel bounds test anywhere: a plane the ray meets outside the tent is always beaten by the one that bounds it there. That is the whole routine, for any panel count: shape is rows in a plane table. The exit is continuous across every panel crossing, with no gap and no overlap ([`../evidence/measurements.md#receivers`](../evidence/measurements.md#receivers)). The one exitless direction is straight down, out of the open bottom the model has no floor for; a safety clamp catches it, and no frame at a sane pitch contains it.

The eye sits at `y = 0.3·tent_len_m`, **derived, not a knob**: thirty percent down the tent is where you lie in a two-person tent. Its height is `tent_eye_h_m`, clamped (below).

### The caps: one plane family

Lying with your feet toward the far end, the seam runs away from you down the middle of the ceiling, forks just short of the end, and the two halves drop apart to the floor corners; in the crotch of that fork sits the small bright triangle of the vent, apex up, its point exactly where the seam divided. Roll your head back and the same thing happens behind you. A cap is a small upright **vent triangle** standing on the floor with two **hip** panels sloping up off its apex to the ceiling. All three of its planes are members of

> `a·x ± y + k·z < L + rake·apex`  (normalised by `‖(a, 1, k)‖`),  with  `a = apex·rake/halfW`,  `k = tent_end_lean + rake`,  `apex = tent_end_apex_h_m`

where `rake` is `+tent_hip_rake`, `−tent_hip_rake` or 0, and `L = tent_len_m` at the far end or `½` at the near one, the `y` sign flipping with it. `rake = 0` gives `a = 0`, `k = tent_end_lean` and offset `L`: a single end wall leaning out by `tent_end_lean` metres per metre of height. `±rake` are the two hips. **The two ends are the same numbers with one sign flipped**, so a statement about one is a statement about both; the far base line sits at `y = tent_len_m`, the near at `y = −½`, and the eye between them. Because the variants are carried on the parent's offset, the family collapses onto the parent **exactly** at `rake = 0`, not nearly. **Law** of the construction.

The cap's shape follows from that one form, and none of it is authored:

- The two hips differ only in the sign of `a`, so they meet exactly on `x = 0`: their junction is the ceiling's centreline seam, the **spine**.
- All three members pass through the apex `A = (0, ±(L − tent_end_lean·apex), apex)`, the point on the end wall at the vent's height, so the spine ends there and the two hip-to-wall junctions begin there.
- Each hip passes through its own floor corner `(±halfW, ±L, 0)`, which is what pins `a`; so the hip-to-wall junction is the straight line from the apex down to the tent's corner.
- The end wall survives exactly on the triangle `|x|/halfW + z/apex < 1`: apex up, base on the floor. The triangle is what the three planes leave.

**The rake floor.** `tent_hip_rake` is the hips' lean in excess of the wall's, and it is floored at **0.15** rather than gated at zero. A hip binds only where it rakes back faster than the wall, so below the floor the cap has no hips and silently reverts to a slab. The seam is safe at any rake (a degenerate cap draws no seam, below); the floor is about **shape**, a few centimetres of setback at the shipped size.

*A converging seam pattern is not a fold.* Two seams converging to a point have a point with a **height**: where the spine meets the vent apex. Where a reference shows lines converging, the free parameter is *where* they converge, not which way they lean ([`../evidence/dead-ends.md#receivers`](../evidence/dead-ends.md#receivers)).

### Framing

**Yaw is lighting and framing at once.** The eye is fixed on the tent's centreline and only the gaze turns, so `view_yaw_deg` sets both which panels are in frame and, since it turns the tent's axes against the world's sun, each panel's incidence. The two cannot be separated. `view_center` places the tent in the grove; the canopy and the sun stay in world space and the panel normals turn with the tent, so every incidence is a real world angle.

**A vent is centred on its own end wall**, so only a gaze pointed near that end contains it; no shape knob slides it sideways. Where a feature is out of frame, the camera is the control that works, and the pitch likewise bounds what is visible below the eye ([`../evidence/measurements.md#receivers`](../evidence/measurements.md#receivers)).

### The two invariants

**The eye is strictly inside every half-space.** That makes every numerator in the exit positive and lets the `min()` skip all sign handling. It is enforced by clamping the eye under the crown, inside both end walls, **and inside each cap's hips**: a hip rakes back faster than its own wall, so it overtakes the wall as the binding constraint as soon as the eye rides above the vent apex, and the near cap binds first, being closer. All are taken as one `min`: over-tightening the eye costs nothing; letting it out costs the whole routine. The side walls need no clamp: the eye is on the centreline, `x = 0`, where they never bind, and neither does a hip's `x` term. Tangent planes circumscribe a convex curve, so an eye inside the true arch is inside the hull for free.

**The arch bows outward and stays single-valued in height.** An intersection of half-spaces is convex whatever the planes do, so the exit is never wrong; what breaks is the *shape*. Put the shoulder inside the straight base-to-crown line and the arc bends the wrong way, the lower tangent planes stop containing the crown edge and slice it off, and pushed far enough the eye ends up outside. And the profile's height is monotone only while the Bézier's control point lies strictly between the ends in height, `tent_shoulder_h_m ∈ (0.25, 0.75)·ridge`; outside that the arc doubles back, the height inversion the smooth normal depends on has two answers, and the normal is undefined. The shoulder height is clamped to `[0.30, 0.70]·ridge`, a margin inside.

**The shape contains its predecessors.** Place the shoulder exactly on the straight line and the three control points are collinear, so the curve is that line and the four strips collapse onto one plane: the flat-sloped tent. Add a zero crown and a long tent and it is the infinite A-frame. These are the regression anchors.

### Nothing downstream changes

The hit's plan point, turned by `view_yaw_deg` and offset by `view_center`, and its height become the receiver point and its height, and transport casts the canopy onto whichever panel the pixel landed on with no further work: the layer read and the analytic woody occluder are the same as on the floor and the cloth. The read is **geometry-free**, valid for any receiver that can name a plan point and a height per pixel. The curtain was one plane; this is one of fifteen, chosen per pixel ([`transport.md`](transport.md)).

**The layer tier is the general-geometry tier.** The enclosure has no single receiver frame, so `receiver` 2 ignores `faithful_canopy` and forces the layer tier ([`transport.md`](transport.md), [`canopy.md`](canopy.md)). This is not the loss it would be on the floor: at enclosure distances the whole cast is deep in the pinhole regime (metres of occluder above fabric a metre or two off the ground), where the disk blur is centimetres wide and the layer tier's height quantisation is invisible beneath it. The cheap tier *is* the correct one here.

### Per-panel light

With a normal per pixel the landed irradiance finally has to resolve the beam and the sky **separately**, because they are different kinds of light: the beam is a direction and takes an incidence cosine; the sky is a hemisphere and takes how much of it the panel can see.

> `E = acc·sunColor·beamF + ambient·skyF`
> `beamF = clamp(n̂·sunDir / max(sunDir.z, 0.15), 0, 2)`,  `skyF = 0.5 + 0.5·n̂.z`

**The crown anchors the normalisation.** `beamF` is a panel's incidence **relative to a horizontal panel**: dividing by the sun's vertical component makes a horizontal panel exactly 1 at any elevation, and every other panel reads as a departure from it. The absolute horizontal factor, `sin el`, arrives with the sun's colour under `sun_cosine` ([`light.md`](light.md)); at `sun_cosine` 0 every horizontal surface lands the full beam, as the floor always has, so "as bright as the other receivers" means exactly 1 on the crown. At `sun_cosine` 1, `beamF·sin el` is the true `n̂·sunDir` only where both limits are clear of it:

- **The cap at 2** holds a panel turned squarely into a sun below 30° to `2·sin el` of its true incidence. It is the ceiling on a panel facing a low sun, which really does collect more than a horizontal one, kept finite.
- **The divisor floor at 0.15** means that below about 8.6° every panel, the crown included, lands `sin el / 0.15` of its incidence: the term is capped rather than allowed to diverge at a horizon sun, and the crown is anchored to the floor only above that.

It is the fold incidence's discipline one dimension up, with the crown where the flat cloth was.

**The arch turns steps into a gradient.** Because the shading normal follows the profile, `beamF` and `skyF` vary **continuously** down each side: the light rolls off the vault the way it rolls off tensioned fabric, brightest where the arch turns into the sun and darkening as it turns away, with no banding at the strips. What remains a step is exactly what should be one: the crown against the arches, and each cap panel against its neighbours. An edge is not a line you draw; it is the boundary between two irradiances.

The two sides are equal **only** when the sun lies in the tent's long vertical plane, `sunDir.x = 0`. With the long axis along +Y those azimuths are **90° and 270°**; `az` 0 or 180 is the sun standing square to the tent, the case of greatest contrast. `skyF` is common to a mirrored pair, as it should be: a hemisphere of sky has no azimuth to favour.

**How the tent reads the fill.** With `canopy_fill` open its sky term is the canopy-filtered sky at the hit's plan position times `skyF`, and the leaves' scattered light, when the diffuse split opens it, enters through the same `skyF` ([`fill.md`](fill.md)).

### Depth and seams

Two more terms multiply `E`, both enclosure-only.

**Depth.** `exp(−t·tent_fade)`, a gentle near-and-far cue (the caps, not distance, close the space): a few percent across the frame at the default, 0.06 per metre. **Authored.**

**The seams are the pole lines and nothing else**: the crown's two long edges, the **spine** down the ceiling's centreline where the hips meet, the **vent triangle's two rising sides** where each hip meets its end wall, the **hem** along each side (below), and the rims where a cap meets the arches and the crown. They are near-contact occluders in the strictest sense, being *on* the cloth, so like the mullion bars they take beam and sky alike. All of them come from one measurement, the distance to the nearest non-winning plane **of a different panel group**:

> `E ← E · exp(−tent_seam · (1 − smoothstep(hw, hw + pen, min_{group(j) ≠ group(win)} d_j)))`
> `d_j = |c_j − n̂_j·hit| / √(1 − (n̂_j·n̂_win)²)`,  `hw = 12 mm`,  `pen = max(hw, 0.004·t)`

**The group filter is the whole difference between a tent and a vault.** Every plane carries a group: the crown; each arch's lower and upper halves; and, at each end, the end wall and each hip separately. A junction between two planes of the same group is an artefact of faceting a curve, not an edge the object has, and skipping it is what lets an arch be four planes and still read as one piece of fabric. A cap's three planes are three groups because their junctions *are* edges: the spine and the vent's sides. With both ends hipped the spine runs the ceiling's whole centreline, coming in over your head from behind, crossing the crown, and forking again at the far vent. The filter cannot hide a junction meant to draw, which is why the rake floor is geometric rather than a grouping.

**The distance is to the edge line, not to the neighbouring plane.** A plane's perpendicular distance is the distance to the edge foreshortened by the dihedral: crossing the winning panel toward the junction closes it at the rate `sin(dihedral)`, so a plane-distance seam paints a band `1/sin(dihedral)` wide in fabric, and the shallowest junction draws the fattest tape. Split the neighbour's normal into its component along the winner's and the rest; only the rest carries you toward the line, which gives the `d_j` above, one dot product and one inverse square root per plane. Every seam then paints the same `hw + pen` of fabric, which is what a taped seam is. Two **parallel** panels have no edge; the distance is infinite, and no seam is drawn. *A distance to a plane is not a distance to that plane's edge, and any pass that paints a band around an edge must say which it means.* **Law.**

The soft edge is the tape's own width near the eye and the **pixel footprint** far off (0.004 rad is a few pixels on the shipped frame), because a junction receding from the eye thins to a sub-pixel line, and a sub-pixel dark line crawls. `tent_seam` is the pole lines' optical depth and the gate; at 0 there are no seams.

### The mesh band

The sides are two materials with a hard hem between them: solid nylon from the floor to the shoulder, insect mesh above it. `tent_mesh ∈ [0,1]` is how far the upper panels are mesh, and it splits the transmission in **both** its halves, because those are the two things a mesh does differently from a weave:

> upper panels:  `body ← body · mix(1, 0.55, tent_mesh)`,  `scatter ← fabric_scatter · (1 − tent_mesh)`

A mesh passes less of what lands on it (throughput toward 0.55) and **diffuses almost none** of what it passes (the forward-scatter share, the term that turns a cast into a glow, toward 0). Taking both makes the band read **darker and crisper at once**, the pair of cues that separates mesh from nylon by eye. On every other panel and receiver the term is 0. This is the receiver interface swapping material **per face** rather than per surface, the axis the floor-curtain-enclosure swap does not reach. At 0 the tent is one fabric to the crown. The 0.55 is **Authored**; the source of the value is not recorded.

**The hem is a panel-group boundary, and the shading normal does not know about it.** Each arch's four strips split into a lower group (tangent at `t = 0, ⅓`) and an upper group (`t = ⅔, 1`), so the seam pass, drawing only cross-group junctions, draws exactly one line along each side. That line lands where the middle strips' tangents cross, which is the widest point of the vault, which is where a real tent's hem sits: within millimetres of the authored shoulder. Across it the shading normal hardly moves: the fabric changes material there, not direction. It is the shallowest dihedral in the tent, which is why the seam must measure to the edge line. *A material boundary and a geometric edge are different things; do not let one stand in for the other.* The reference has no crease at the shoulder, so the hem is carried by material and the group filter, and survives the side being perfectly smooth.

**Where this leads.** A mesh panel is a window onto the canopy: the honest end of this axis is an upper panel running the sky view's transport ([`sky-view.md`](sky-view.md)) instead of the fabric's. `tent_mesh` is the one-sided approximation, which darkens and de-diffuses the band but lets no light reach the eye that did not first land on it. **Not built.**

### What carries over, and what is inert

**The cloth coordinate.** The coordinate generalises off the crown: `v` is the drop **below the crown plane**, so the pleat field's rod sits on the tent's pinned top on every panel at once (a tent is pinned at its crown and free at its hem as a curtain is at its rod, so `fold_coarsen` broadens the ripples downward the right way round); `u` runs along each panel's horizontal tangent, down the tent on the sides, across it on the caps, and across it on the crown, whose plan normal is degenerate and takes an explicit fallback.

**Curtain-only, and switched off here:** `cloth_distance_m` (the ray cast supplies the receiver's position); the window aperture and the mullion grid, which are thrown against a plane the enclosure does not have; and `fold_warp` as a warp, since it slides a read along a flat cast plane and there is none. The tent's read is already the real geometry. The shading half (`fold_depth`, the sheen, the nap) still applies.

## Approximations and limits

- **Central ray only** (mullion, aperture, fold warp) — **Approximation.** No spread across the source disk; the penumbra term stands in for it, sub-millimetre at centimetre depths.
- **Bars without depth** — **Approximation.** No jamb thickness, no reveal shadow.
- **The fold warp is first-order** — **Approximation.** It re-samples a cast baked against a flat plane. The occluder distance really varies by ±`fold_warp` across a pleat and the penumbra should breathe with it; flank self-shadowing is not modelled; the warped read can land just outside the cast frame, by `|fold_warp/gy|` metres, where the edge texel answers.
- **Vertical pleat normals** — **Approximation.** The flank normal has no vertical component; the coarsening's small `∂Δy/∂v` is dropped so it tilts nothing of its own.
- **Thickness and orientation as two knobs** — **Approximation.** The pile band is not derived from the path length through the pile at incidence.
- **The wood's penumbra on the curtain's layer path** — **Approximation.** Measured partly in plan depth rather than up the cloth.
- **Diffusion after the mesopic shift** — **Approximation.** Physically the fabric spreads light before any eye adapts; negligible, since the mesopic shift lives in deep shade at a low sun and the glow in the hot patches.
- **Diffusion across the flat cloth** — **Approximation.** Not along the pleated surface; sub-percent at any real `fold_warp`.
- **The diffusion's capped reach** — **Approximation.** A wide radius falls short of the metres asked for.
- **The diffusion's radius in the enclosure** — **Approximation.** Its scale is the head-on cloth map's, so the radius is uniform in screen space across receding fabric. Deliberate: a depth-aware blur is another tier.
- **Faceted hull, smooth shading** — **Approximation.** The silhouette stands at most about 1.5 cm outside the arc; the road onward is more strips, not a different method. Caps and crown are genuinely flat.
- **Both ends the same cap** — **Approximation.** A real two-person tent has a door at its head; the near end is the foot end mirrored.
- **Mesh as material, not transport** — **Approximation.** Light reaching the eye through a mesh panel still landed on it first.
- **No interreflection** — **Approximation.** A shaded slope is lit only by its own sky share; in a real white tent much of its light bounces off the lit slope opposite. The honest fix is a bounce term, not a bigger ambient.
- **No tent floor** — **Approximation.** The polytope is open below.
- **`window_wall`** — **Authored.** Front-side room light the model does not otherwise have.

## Not built

Detail and status in [`../exploration/open.md`](../exploration/open.md).

- **The directional nap.** A real cut pile is brushed: the fibres lean, and one direction field should drive both the sheen lobe in reflection and a transmission asymmetry, so the grain you see and the glow you see through agree. What exists is the sheen plus a fine ripple: a grain, not a lean. Staged, gated off.
- **The pile band from path length.** One physical model in which `fold_depth`'s thickness and the fold incidence collapse into each other.
- **A mesh panel as a window.** The enclosure's upper panels running the sky view's transport.
- **A material axis in the registry.** Material named separately from camera, the moment a look wants a pair (mesh read as sky) that does not exist.
- **The tent's door, vestibule, poles and guy lines.**
- **A bounce term in the enclosure.** Interreflection between the lit and shaded slopes.
- **A pyramid for the lateral diffusion.** The next rung if reach matters more than pass count.
- **A depth-aware diffusion in the enclosure.**

## Related

- [`transport.md`](transport.md): the height-minus-receiver read, the bulk throw, one program per camera.
- [`light.md`](light.md): the cosine law and the incidence table the floor, cloth and tent apply.
- [`fill.md`](fill.md): the hemisphere integral, and how each receiver reads it.
- [`canopy.md`](canopy.md): the woody occluder, the faithful cast, the layer tier.
- [`source.md`](source.md): the widened source radius the mullion penumbra multiplies.
- [`camera.md`](camera.md): the tone tail, and where it sits when the diffusion pass exists.
- [`sky-view.md`](sky-view.md): the retina, the receiver that has no surface, and the diffusion as veiling glare.
- [`season.md`](season.md): the litter, the floor's other material.
- [`transitions.md`](transitions.md): why a receiver change rebuilds under a cloud.
- [`../contracts/gates-and-rungs.md`](../contracts/gates-and-rungs.md): the diffusion as a style rung, the wrap as its fallback, the extension contract for a new receiver.
- [`../contracts/preservation.md`](../contracts/preservation.md): what every gate here owes when off.
- [`../contracts/looks.md`](../contracts/looks.md): `curtain 1`, `curtain 2`, `tent 1` and their intent.
- [`../evidence/dead-ends.md#receivers`](../evidence/dead-ends.md#receivers), [`../evidence/measurements.md#receivers`](../evidence/measurements.md#receivers): the attempts and the numbers behind it.
- [`../implementation.md`](../implementation.md): where each part lives in the code.
