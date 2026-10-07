// ============================================================================
// run.js — the real-pixel test harness for komorebi. Optional local tooling, not part of the nix flow.
//
//   cd test-gl && npm install && npx playwright install chromium && node run.js
//
// Every other automated check in this repo stops short of a pixel: the bun tests exercise pure modules and
// the shaders are only validated offline. This one renders. It serves the repo over http (ES modules can't
// load from file://), drives headless Chromium — real WebGL2 on SwiftShader/ANGLE, EXT_color_buffer_float
// and all — and compares actual framebuffer bytes.
//
// The point is suite 2. Every gated feature on this engine ships with the same claim: "off is byte-identical
// to the look before it" (the quality-rung contract, spec §9). That claim has always been argued from the
// source. Here it is executed: two engines, same frozen look, one with the gate's whole knob family cranked
// behind a zero gate — and the frames must match to the byte.
//
// Suites: SMOKE (every preset renders, non-degenerate, GL-clean, one PNG each into out/)
//         GATE  (the byte-identical off-path claims)
//         DETERMINISM (two independent engines agree; and a single engine holds still)
//         TRANSITIONS (each routing tier — morph / crossfade / dissolve / mode — driven to completion;
//                      logic-only, no pixels: transitions aren't byte-stable by design)
//         ROBUSTNESS (a throwing onFrame keeps the loop alive; WebGL context loss + restore recovers
//                     the same frame, one loop, paused state kept; `node run.js --robust` runs only this)
// Opt-in, not suites: `--transition <from> <to>` (a watched transition), `--look <preset> key=value ...`
// (a look with overrides, for eyes), `--gate [substring ...]` (only the gate invariants — the rows whose
// name matches, if any are given — the fast loop for a gate you are adding), `--fill` (only the sky fill's
// shader-vs-reference check), `--sky` (only the look-up ray's) and `--edge` (only the soft-edge rows: rim, halo, stamp).
// ============================================================================
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));   // the repo root — what gets served
const OUT = join(ROOT, 'test-gl', 'out');
const SMOKE_FRAMES = 60;    // ticks a smoke run renders before its screenshot (long enough for the bake to warm and any governor to settle)
const GATE_FRAMES = 24;     // ticks a gate comparison settles for (motion is frozen, so this only has to clear the bake)
const STILL_FRAMES = [20, 60];   // the stillness proof: one engine, two captures forty ticks apart

// ---------------------------------------------------------------------------
// Suite 2 as data: one row per invariant. `a` and `b` are param overrides merged over the preset (and then
// over the harness's motion freeze); the assertion is always "these two frames are byte-identical".
// Adding an invariant is adding a line. (`rebake: true` re-bakes before the capture — only a faithful look needs it.)
// (`differ: true` inverts the assertion — the two frames must NOT match, and GL must stay clean: the row proves a gate
// is a real switch, so the byte-identical rows beside it cannot be passing only because the feature is dead.)
// (`near: N` is the continuity row: the frames may differ, but nowhere by more than N grey levels — a sweep that steps by a hair
// must move the picture by a hair. A pop is a difference this large from a change that small.)
// (`lit: [lo, hi]` is the energy row: the frames must differ AND frame b's mean level must sit between lo and hi times
// frame a's. It is what says a split of the light moved it somewhere instead of throwing it away.)
// (`pin: '<hash>'` is the row with no `b`: frame a's own hash must be the one written down BEFORE the change it guards. Byte-identical
// "a == b" rows say a gate is a gate; a pin says the frame itself did not move — the proof for a change that touches no gate at all,
// like moving the sky view's wood out of the layer texture's alpha. The hash is the harness's FNV-1a over the 320x180 frame.)
// ---------------------------------------------------------------------------
const FABRIC_FAMILY = {
  fabric_tt: 0.9, fabric_tint_r: 0.9, fabric_tint_g: 0.2, fabric_tint_b: 0.7,
  fold_depth: 0.9, fold_scale: 1.4, fold_coarsen: 0.9, fold_warp: 0.3,
  velvet_sheen: 1, fabric_scatter: 0.9, glow_bleed: 0.5, glow_bleed_m: 0.2,
  mullion_tau: 3, mullion_pitch_m: 0.2, mullion_bar_m: 0.04, mullion_depth_m: 0.1,
  window_w_m: 2, window_h_m: 2, window_cx_m: 0.3, window_cy_m: 1.2, window_wall: 0.4,
};

const INVARIANTS = [
  // The whole receiver=1 fabric surface, cranked, against a floor look that never asks for it.
  { name: 'floor look ignores the entire fabric family', preset: 'park 1',
    a: { receiver: 0 }, b: { receiver: 0, ...FABRIC_FAMILY } },
  // The lateral-diffusion tier alone: its gate adds/drops two HDR passes, which is the kind of thing that
  // leaks a rounding difference even when the mix weight is dead.
  { name: 'glow tier off-path: receiver 0 + glow_bleed 0.4', preset: 'park 1',
    a: { receiver: 0 }, b: { receiver: 0, glow_bleed: 0.4, glow_bleed_m: 0.08 } },
  // On the cloth itself, with the two authored-occluder gates shut: their geometry knobs must be dead code.
  { name: 'curtain with mullion_tau 0 / window_w_m 0 ignores their geometry', preset: 'curtain 1',
    a: { mullion_tau: 0, window_w_m: 0, fold_warp: 0 },
    b: { mullion_tau: 0, window_w_m: 0, fold_warp: 0,
         mullion_pitch_m: 0.1, mullion_bar_m: 0.09, mullion_depth_m: 0.5,
         window_h_m: 5, window_cx_m: 1.2, window_cy_m: 3, window_wall: 0.9 } },
  // Zero-vs-absent: cheap, but it pins the DEFAULTS merge path — an off gate whose default is not its off
  // value would show up here and nowhere else.
  { name: 'sway_pitch 0 == absent (layer path)', preset: 'memories', a: {}, b: { sway_pitch: 0 } },
  { name: 'chromatic_aberration 0 == absent (layer path)', preset: 'memories', a: {}, b: { chromatic_aberration: 0 } },
  { name: 'branch_tau 0 == absent (layer path)', preset: 'memories', a: {}, b: { branch_tau: 0 } },
  // Autumn senescence (§4.5). The shipped looks sit at phenology 0.5, below turn_start, so no leaf has begun to turn
  // and the whole pigment family — capacity, clock, vein share — has to be dead code: not "close", the same bytes.
  { name: 'pigment family inert at summer (layer path)', preset: 'memories',
    a: {}, b: { phenology: 0.5, anthocyanin: 1, tannin: 1, turn_span: 0.3, wall_fraction: 0 } },
  { name: 'phenology 0.5 == absent (layer path)', preset: 'memories', a: {}, b: { phenology: 0.5 } },
  // The sieve tier is not gated by wall_fraction alone: at s_j = 0 wall and cell are one tissue, so a vein share
  // must still change nothing (it is what lets a species bundle carry one without touching a summer look)...
  { name: 'wall_fraction at summer == absent (layer path)', preset: 'memories', a: {}, b: { wall_fraction: 0.3, anthocyanin: 0.8 } },
  // ...and park 1 is faithful: its leaves ride faithData, a second write of the same tau. `rebake` because a faithful
  // look's first frame is baked against an empty sun cloud (rebuildAll bakes before regenSource) and shows no leaf
  // colour at all, so without it this row would compare two dark frames and could never fail.
  { name: 'pigment family inert at summer (faithful path)', preset: 'park 1', rebake: true,
    a: {}, b: { phenology: 0.5, anthocyanin: 1, tannin: 1, turn_span: 0.3, wall_fraction: 0.3 } },
  // LIGHT DECIDES WHO TURNS FIRST (§4.5). turn_exposure 0 is P0's per-leaf hash and nothing else: the same bytes as a look that
  // never heard of the knob — at the shipped summer, and in a FALL frame, where the pass would have something to move (phenology 1,
  // anthocyanin 0.8, the frame P0 shipped), on the layer path and on the faithful path (rebake: see above)...
  { name: 'turn_exposure 0 == absent (layer path)', preset: 'memories', a: {}, b: { turn_exposure: 0 } },
  { name: 'turn_exposure 0 keeps the P0 fall frame (layer path)', preset: 'memories',
    a: { phenology: 1, anthocyanin: 0.8 }, b: { phenology: 1, anthocyanin: 0.8, turn_exposure: 0 } },
  { name: 'turn_exposure 0 keeps the P0 fall frame (faithful path)', preset: 'park 1', rebake: true,
    a: { phenology: 1, anthocyanin: 0.8 }, b: { phenology: 1, anthocyanin: 0.8, turn_exposure: 0 } },
  // ...armed at summer it still changes nothing (no leaf has begun, so none has an order to be put in)...
  { name: 'turn_exposure at summer == absent (layer path)', preset: 'memories', a: {}, b: { turn_exposure: 1, anthocyanin: 0.8 } },
  // ...and the other half: above 0 it is a real switch on a frame that is turning, on both paths — without these a pass that never
  // reached the leaves would satisfy every row above. Mid-turn (phenology 0.8), where the order shows as which leaves have gone.
  { name: 'turn_exposure 1 changes a fall frame (layer path)', preset: 'memories', differ: true,
    a: { phenology: 0.8, anthocyanin: 0.8 }, b: { phenology: 0.8, anthocyanin: 0.8, turn_exposure: 1 } },
  { name: 'turn_exposure 1 changes a fall frame (faithful path)', preset: 'park 1', rebake: true, differ: true,
    a: { phenology: 0.8, anthocyanin: 0.8 }, b: { phenology: 0.8, anthocyanin: 0.8, turn_exposure: 1 } },
  // RANKED VS ABSOLUTE, AS A BLEND (§4.5). exposure_absolute 0 is the rank and nothing else: the P1 frame, byte for byte, on both paths —
  // a leaf-off frame (phenology 1: every leaf fully turned, so the red gain the blend moves is all that shows) under turn_exposure 1...
  { name: 'exposure_absolute 0 keeps the P1 frame (layer path)', preset: 'memories',
    a: { phenology: 1, anthocyanin: 0.8, turn_exposure: 1 }, b: { phenology: 1, anthocyanin: 0.8, turn_exposure: 1, exposure_absolute: 0 } },
  { name: 'exposure_absolute 0 keeps the P1 frame (faithful path)', preset: 'park 1', rebake: true,
    a: { phenology: 1, anthocyanin: 0.8, turn_exposure: 1 }, b: { phenology: 1, anthocyanin: 0.8, turn_exposure: 1, exposure_absolute: 0 } },
  // ...and the other half: at 1 it is a real switch on that very frame, on both paths (else a blend that never reached the leaves would pass above)
  { name: 'exposure_absolute 1 changes the P1 frame (layer path)', preset: 'memories', differ: true,
    a: { phenology: 1, anthocyanin: 0.8, turn_exposure: 1 }, b: { phenology: 1, anthocyanin: 0.8, turn_exposure: 1, exposure_absolute: 1 } },
  { name: 'exposure_absolute 1 changes the P1 frame (faithful path)', preset: 'park 1', rebake: true, differ: true,
    a: { phenology: 1, anthocyanin: 0.8, turn_exposure: 1 }, b: { phenology: 1, anthocyanin: 0.8, turn_exposure: 1, exposure_absolute: 1 } },
  // ABSCISSION (§4.5). leaf_drop 0 is the gate: with it down the whole family (when it starts, how long it takes, how far light orders it)
  // is dead code, and the frame is the one before the family existed — at the shipped summer, where the season would keep it dead anyway,
  // and in a FALL frame (phenology 0.9, past drop_start − ε), where only the gate itself does. Layer path and faithful path (rebake: see above)...
  { name: 'drop family inert at leaf_drop 0 (layer path)', preset: 'memories',
    a: {}, b: { leaf_drop: 0, drop_start: 0.6, drop_span: 0.1, drop_exposure: 1 } },
  { name: 'drop family inert at leaf_drop 0 in a fall frame (layer path)', preset: 'memories',
    a: { phenology: 0.9, anthocyanin: 0.8, turn_exposure: 1 }, b: { phenology: 0.9, anthocyanin: 0.8, turn_exposure: 1, leaf_drop: 0, drop_start: 0.6, drop_span: 0.1, drop_exposure: 1 } },
  { name: 'drop family inert at leaf_drop 0 in a fall frame (faithful path)', preset: 'park 1', rebake: true,
    a: { phenology: 0.9, anthocyanin: 0.8, turn_exposure: 1 }, b: { phenology: 0.9, anthocyanin: 0.8, turn_exposure: 1, leaf_drop: 0, drop_start: 0.6, drop_span: 0.1, drop_exposure: 1 } },
  // (zero-vs-absent pins the DEFAULTS merge path, so it too is taken in a fall frame: at summer a default of 1 would be as inert as a default of 0)
  { name: 'leaf_drop 0 == absent (layer path)', preset: 'memories', a: { phenology: 0.9 }, b: { phenology: 0.9, leaf_drop: 0 } },
  { name: 'leaf_drop 0 == absent (faithful path)', preset: 'park 1', rebake: true, a: { phenology: 0.9 }, b: { phenology: 0.9, leaf_drop: 0 } },
  // ...and the other half: above 0 the canopy thins, on every camera that draws leaves — the floor (afternoon 7, park 1), the sky view,
  // the cloth and the tent — or a drop that never reached the buffers would satisfy every row above. Phenology 0.9: two thirds of the way
  // through the span, so some have gone and some have not.
  { name: 'leaf_drop 1 thins the canopy (layer path)', preset: 'afternoon 7', differ: true,
    a: { phenology: 0.9 }, b: { phenology: 0.9, leaf_drop: 1 } },
  { name: 'leaf_drop 1 thins the canopy (faithful path)', preset: 'park 1', rebake: true, differ: true,
    a: { phenology: 0.9 }, b: { phenology: 0.9, leaf_drop: 1 } },
  { name: 'leaf_drop 1 thins the canopy (sky view)', preset: 'canopy 1', differ: true,
    a: { phenology: 0.9 }, b: { phenology: 0.9, leaf_drop: 1 } },
  { name: 'leaf_drop 1 thins the canopy (curtain)', preset: 'curtain 1', rebake: true, differ: true,
    a: { phenology: 0.9 }, b: { phenology: 0.9, leaf_drop: 1 } },
  { name: 'leaf_drop 1 thins the canopy (tent)', preset: 'tent 1', differ: true,
    a: { phenology: 0.9 }, b: { phenology: 0.9, leaf_drop: 1 } },
  // ...and a canopy with NO leaves left is a lit scene, not an unbaked one: the faithful bake once returned early on an empty leaf set and left
  // its shadow texture at zero — a black floor, the moment leaf_drop 1 reached leaf-off (measured ×0.36 of the leafy frame, both looks). The wood still
  // casts and the leafy shadow is a patch on a lit floor, so the park's frame is barely brighter (×1.02) and the cloth's a fifth (×1.21): above 0.9, not below.
  { name: 'a bare canopy is a lit floor, not an unbaked one (faithful path)', preset: 'park 1', rebake: true, lit: [0.9, 1.25],
    a: {}, b: { phenology: 1, leaf_drop: 1 } },
  { name: 'a bare canopy is a lit cloth, not an unbaked one (curtain)', preset: 'curtain 1', rebake: true, lit: [1.05, 1.6],
    a: {}, b: { phenology: 1, leaf_drop: 1 } },
  // THE LITTER (§4.7, P3b). `litter` is the carpet's own gate, separate from leaf_drop so the canopy half can be judged alone: at 0 the whole family (how fast
  // it browns, how far the season's wind carries it, how big its texture is) is dead code and the floor is the one before it existed — taken in a FALL frame where
  // leaves have fallen and the carpet would bite (phenology 0.9, leaf_drop 1: two thirds of the span, so there is plenty to lay), on the layer path and the
  // faithful one (rebake: see above)...
  { name: 'litter family inert at litter 0 (layer path)', preset: 'afternoon 7',
    a: { leaf_drop: 1, phenology: 0.9 }, b: { leaf_drop: 1, phenology: 0.9, litter: 0, litter_age: 0.5, litter_drift_m: 2, litter_resolution: 512 } },
  { name: 'litter family inert at litter 0 (faithful path)', preset: 'park 1', rebake: true,
    a: { leaf_drop: 1, phenology: 0.9 }, b: { leaf_drop: 1, phenology: 0.9, litter: 0, litter_age: 0.5, litter_drift_m: 2, litter_resolution: 512 } },
  // (zero-vs-absent pins the DEFAULTS merge path, so it too is taken in a frame the carpet would bite: a default of 1 would show here and nowhere else)
  { name: 'litter 0 == absent (layer path)', preset: 'afternoon 7', a: { leaf_drop: 1, phenology: 0.9 }, b: { leaf_drop: 1, phenology: 0.9, litter: 0 } },
  { name: 'litter 0 == absent (faithful path)', preset: 'park 1', rebake: true, a: { leaf_drop: 1, phenology: 0.9 }, b: { leaf_drop: 1, phenology: 0.9, litter: 0 } },
  // ...a carpet with nothing on it is the floor: at the shipped summer no leaf has fallen, so the gate open is the gate shut (nothing is even allocated)...
  { name: 'litter 1 with nothing fallen == litter 0 (layer path)', preset: 'afternoon 7', a: { leaf_drop: 1, litter: 0 }, b: { leaf_drop: 1, litter: 1 } },
  { name: 'litter 1 with leaf_drop 0 == litter 0 (faithful path)', preset: 'park 1', rebake: true, a: { phenology: 0.9, litter: 0 }, b: { phenology: 0.9, litter: 1 } },
  // ...and the other half: above 0 the leaves are on the floor, on both floor paths, and with the fill and the split open (where the carpet is lit by what
  // lights the ground beside it, S and Tsky) — or a carpet that never reached the floor's material would satisfy every row above.
  { name: 'litter 1 lays a carpet (layer path)', preset: 'afternoon 7', differ: true,
    a: { leaf_drop: 1, phenology: 0.9 }, b: { leaf_drop: 1, phenology: 0.9, litter: 1 } },
  { name: 'litter 1 lays a carpet (faithful path)', preset: 'park 1', rebake: true, differ: true,
    a: { leaf_drop: 1, phenology: 0.9 }, b: { leaf_drop: 1, phenology: 0.9, litter: 1 } },
  { name: 'litter 1 lays a carpet in the lit shade (layer path, fill and split open)', preset: 'afternoon 7', differ: true,
    a: { leaf_drop: 1, phenology: 0.9, canopy_fill: 1, leaf_diffuse: 0.95 }, b: { leaf_drop: 1, phenology: 0.9, canopy_fill: 1, leaf_diffuse: 0.95, litter: 1 } },
  { name: 'litter 1 lays a carpet in the lit shade (faithful path, fill and split open)', preset: 'park 1', rebake: true, differ: true,
    a: { leaf_drop: 1, phenology: 0.9, canopy_fill: 1, leaf_diffuse: 0.95 }, b: { leaf_drop: 1, phenology: 0.9, canopy_fill: 1, leaf_diffuse: 0.95, litter: 1 } },
  // the family is live once the gate is open: how browned they lie, how far the season's wind carried them, and which way it blew
  { name: 'litter_age is live (layer path)', preset: 'afternoon 7', differ: true,
    a: { leaf_drop: 1, phenology: 0.9, litter: 1, litter_age: 0.01 }, b: { leaf_drop: 1, phenology: 0.9, litter: 1, litter_age: 1 } },
  { name: 'litter_drift_m is live (layer path)', preset: 'afternoon 7', differ: true,
    a: { leaf_drop: 1, phenology: 0.9, litter: 1, litter_drift_m: 0 }, b: { leaf_drop: 1, phenology: 0.9, litter: 1, litter_drift_m: 2 } },
  { name: 'the authored wind direction carries the litter (faithful path)', preset: 'park 1', rebake: true, differ: true,
    a: { leaf_drop: 1, phenology: 0.9, litter: 1, wind_direction_deg: 0 }, b: { leaf_drop: 1, phenology: 0.9, litter: 1, wind_direction_deg: 180 } },
  // UNREAD ELSEWHERE: the curtain and the tent transmit through fabric and the sky view has no surface, so none of them reads the carpet — and none of them
  // bakes it: the same look with the gate open is the same frame, to the byte. (These looks are not dropping, so give them a fall to be unmoved by.)
  { name: 'the curtain does not read the litter', preset: 'curtain 1',
    a: { leaf_drop: 1, phenology: 0.9, litter: 0 }, b: { leaf_drop: 1, phenology: 0.9, litter: 1 } },
  { name: 'the tent does not read the litter', preset: 'tent 1',
    a: { leaf_drop: 1, phenology: 0.9, litter: 0 }, b: { leaf_drop: 1, phenology: 0.9, litter: 1 } },
  { name: 'the sky view does not read the litter', preset: 'canopy 1',
    a: { leaf_drop: 1, phenology: 0.9, litter: 0 }, b: { leaf_drop: 1, phenology: 0.9, litter: 1 } },
  // THE SKY FILL (§4.7): the shade lit through the canopy. canopy_fill 0 is the old floor, so the whole family behind it —
  // the leaf albedo, the ray count, the texture size — has to be dead code on every camera that could read it...
  { name: 'sky fill family inert at canopy_fill 0 (layer path)', preset: 'memories',
    a: {}, b: { canopy_fill: 0, fill_scatter: 0.8, fill_directions: 32, fill_resolution: 128 } },
  { name: 'canopy_fill 0 == absent (layer path)', preset: 'memories', a: {}, b: { canopy_fill: 0 } },
  // ...on the faithful path, whose layers are 1x1 unless the fill asks for a low-res set (rebake: see above)...
  { name: 'sky fill family inert at canopy_fill 0 (faithful path)', preset: 'park 1', rebake: true,
    a: {}, b: { canopy_fill: 0, fill_scatter: 0.8, fill_directions: 32, fill_resolution: 128 } },
  // ...on the cloth, which reads Tsky through a different line of the shader...
  { name: 'sky fill family inert at canopy_fill 0 (curtain)', preset: 'curtain 1',
    a: {}, b: { canopy_fill: 0, fill_scatter: 0.8, fill_directions: 32, fill_resolution: 128 } },
  // ...on the tent, the other cloth receiver, whose per-panel light is its own program...
  { name: 'sky fill family inert at canopy_fill 0 (tent)', preset: 'tent 1',
    a: {}, b: { canopy_fill: 0, fill_scatter: 0.8, fill_directions: 32, fill_resolution: 128 } },
  // ...and the sky view has no surface to light: it must not read the fill AT ALL, whatever is asked of it.
  { name: 'the sky view ignores the fill (canopy_fill 1 == 0)', preset: 'canopy 1',
    a: { canopy_fill: 0 }, b: { canopy_fill: 1, fill_scatter: 0.8, fill_directions: 32, fill_resolution: 128 } },
  // The other half of every row above: the gate really is a switch. Without these, a fill that never reaches the screen
  // would pass them all.
  { name: 'canopy_fill 1 changes the shade (layer path)', preset: 'memories', differ: true, a: { canopy_fill: 0 }, b: { canopy_fill: 1 } },
  { name: 'canopy_fill 1 changes the shade (faithful path)', preset: 'park 1', rebake: true, differ: true, a: { canopy_fill: 0 }, b: { canopy_fill: 1 } },
  { name: 'canopy_fill 1 changes the cloth (curtain)', preset: 'curtain 1', differ: true, a: { canopy_fill: 0 }, b: { canopy_fill: 1 } },
  { name: 'canopy_fill 1 changes the cloth (tent)', preset: 'tent 1', differ: true, a: { canopy_fill: 0 }, b: { canopy_fill: 1 } },
  { name: 'fill_scatter is live at canopy_fill 1 (layer path)', preset: 'memories', differ: true,
    a: { canopy_fill: 1, fill_scatter: 0 }, b: { canopy_fill: 1, fill_scatter: 0.8 } },
  // A LEAF IS NOT A WINDOW (§4.5). leaf_diffuse 0 is k = 0: tap()'s else, FS_FAITH's else, the P0b proxy verbatim and a
  // sky view compiled with the literal 0.0 — the same bytes as a look that never heard of the knob, on every camera...
  { name: 'leaf_diffuse 0 == absent (layer path)', preset: 'memories', a: {}, b: { leaf_diffuse: 0 } },
  { name: 'leaf_diffuse 0 == absent (faithful path)', preset: 'park 1', rebake: true, a: {}, b: { leaf_diffuse: 0 } },
  // ...with the fill open, where P0b's proxy is what has to survive the refactor...
  { name: 'leaf_diffuse 0 keeps the P0b fill (layer path)', preset: 'memories',
    a: { canopy_fill: 1, fill_scatter: 0.15 }, b: { canopy_fill: 1, fill_scatter: 0.15, leaf_diffuse: 0 } },
  { name: 'leaf_diffuse 0 keeps the P0b fill (faithful path)', preset: 'park 1', rebake: true,
    a: { canopy_fill: 1, fill_scatter: 0.15 }, b: { canopy_fill: 1, fill_scatter: 0.15, leaf_diffuse: 0 } },
  { name: 'leaf_diffuse 0 keeps the P0b fill (curtain)', preset: 'curtain 1', a: { canopy_fill: 1 }, b: { canopy_fill: 1, leaf_diffuse: 0 } },
  { name: 'leaf_diffuse 0 keeps the P0b fill (tent)', preset: 'tent 1', a: { canopy_fill: 1 }, b: { canopy_fill: 1, leaf_diffuse: 0 } },
  // ...and the sky view, which reads the split from P0c-sky on (§4.9): at 0 it is the frame it was (rows below).
  // Above 0 the P0b proxy is OFF: its albedo is the authored stand-in for exactly the light the split measures, and counting
  // both would count it twice. The knob is inert, not merely small.
  { name: 'fill_scatter is inert once leaf_diffuse is up (layer path)', preset: 'memories',
    a: { canopy_fill: 1, leaf_diffuse: 0.5, fill_scatter: 0 }, b: { canopy_fill: 1, leaf_diffuse: 0.5, fill_scatter: 0.8 } },
  { name: 'fill_scatter is inert once leaf_diffuse is up (faithful path)', preset: 'park 1', rebake: true,
    a: { canopy_fill: 1, leaf_diffuse: 0.5, fill_scatter: 0 }, b: { canopy_fill: 1, leaf_diffuse: 0.5, fill_scatter: 0.8 } },
  // THE MARGINAL FADE (§5.3). A leaf — or a whole tree — fading in has its fade folded into tau on the CPU, so the beam's neutral depth
  // k·coverage has to carry the same fade (iFade) or the ballistic shadow pops to full the instant the leaf exists. Step the count
  // from "none" to 0.005 of one: the fade is 0.005, and the picture must move by about that much — not by a whole leaf's shadow per twig.
  // (Measured: a faded-in leaf moves the frame by 2 and 1 grey levels; a bake whose alpha ignores the fade, by 39 and 46.)
  // (Leaves only: a fractional tree_count also re-spaces the trees that are already there, so its frames cannot be compared this way —
  // the grove's own test holds the marginal tree's fade in iFade instead.)
  { name: 'a marginal leaf fades its ballistic shadow with it (layer path)', preset: 'memories', near: 10,
    a: { canopy_fill: 1, leaf_diffuse: 0.95, foliage_density: 17 / 39 }, b: { canopy_fill: 1, leaf_diffuse: 0.95, foliage_density: 17.005 / 39 } },
  { name: 'a marginal leaf fades its ballistic shadow with it (faithful path)', preset: 'park 1', rebake: true, near: 10,
    a: { canopy_fill: 1, leaf_diffuse: 0.95, foliage_density: 1.55 }, b: { canopy_fill: 1, leaf_diffuse: 0.95, foliage_density: 1.55 + 0.005 / 20 } },
  // The other half of every row above: the split is a real switch, and it reaches the screen on each camera that reads it.
  // With the fill SHUT it only takes the diffuse share out of the beam...
  { name: 'leaf_diffuse darkens the beam (layer path)', preset: 'memories', differ: true, a: {}, b: { leaf_diffuse: 0.95 } },
  { name: 'leaf_diffuse darkens the beam (faithful path)', preset: 'park 1', rebake: true, differ: true, a: {}, b: { leaf_diffuse: 0.95 } },
  // ...and with it open, the energy has to go somewhere. d·T leaves the beam and the fill hands it to the shade, so a frame whose
  // diffuse light was thrown away (S never written, never read) sits BELOW the one that still carries it: memories 0.70 against its
  // 1.49, the tent 0.70 against 0.99, and the curtain — a dim look, where its beam is nearly dark and S is the whole change: ×1.00
  // with S thrown away — 1.00 against 1.53 (S read at the vertical plane's view factor, 0.5; read at 1 it was 2.0, double). The bounds
  // below sit between the two, so they are floors under a loss, not a fit to a number. (park 1 is not here: its leaves pass so little
  // of the sun that the frame cannot tell; the faithful S is held by the fill check's bookkeeping rows instead.)
  { name: 'the diffuse light lands in the shade (layer path)', preset: 'memories', lit: [1.0, 1.6],
    a: { canopy_fill: 1, leaf_diffuse: 0 }, b: { canopy_fill: 1, leaf_diffuse: 0.95 } },
  // the cloth and the tent used to read Tsky alone; with the beam gone dark they have to read S too, or the energy leaks
  { name: 'the diffuse light lands on the cloth (curtain)', preset: 'curtain 1', lit: [1.05, 1.6],
    a: { canopy_fill: 1, leaf_diffuse: 0 }, b: { canopy_fill: 1, leaf_diffuse: 0.95 } },
  { name: 'the diffuse light lands on the cloth (tent)', preset: 'tent 1', lit: [0.9, 1.3],
    a: { canopy_fill: 1, leaf_diffuse: 0 }, b: { canopy_fill: 1, leaf_diffuse: 0.95 } },
  // THE LEAF IS A LANTERN (§4.9, P0c-sky). The sky view's wood moved out of the layer texture's alpha into a texture of its own
  // (R16F per layer), and the leaf bake stopped masking alpha, so coverage rides it on every camera. At leaf_diffuse 0 none of that may
  // be visible: every look, canopy 1-4 above all (the only looks with a sky camera), is the frame it was before the move. These are
  // PINS, hashes written down from the engine before the change (the rest of the file's rows compare two frames of one engine,
  // which a texture move could survive by moving both).
  { name: 'canopy 1 is the frame it was before the texture move', preset: 'canopy 1', pin: '5dc2bd4c' },
  { name: 'canopy 2 is the frame it was before the texture move', preset: 'canopy 2', pin: '5d41e98a' },
  { name: 'canopy 3 is the frame it was before the texture move', preset: 'canopy 3', pin: '212b9cef' },
  { name: 'canopy 4 is the frame it was before the texture move', preset: 'canopy 4', pin: '4c5e56d5' },
  // ...and the cameras that never had a wood texture to read: a 1x1 unread R16F beside them changes nothing, and the fill's program text
  // (the shared ray's signature moved) bakes the same shade.
  { name: 'park 1 is the frame it was (faithful floor: wood texture 1x1, unread)', preset: 'park 1', pin: '6b57b555' },
  { name: 'curtain 1 is the frame it was (cloth)', preset: 'curtain 1', pin: '7cad5bb5' },
  { name: 'memories is the frame it was (layer floor)', preset: 'memories', pin: 'bdcffc3c' },
  { name: 'afternoon 7 is the frame it was (layer floor)', preset: 'afternoon 7', pin: '13525cdd' },
  // The ONE pin that moved, on purpose: it is a leaf_diffuse > 0 frame, and P0c-edge reads every texel there as a mixture of leaf and gap (§4.5), so the
  // frame P0c-sky pinned (eb960892: the shared ray's new signature, the slab) is not this one. Re-recorded from the engine after the change; what says it moved
  // the right way is not this hash but the soft-edge rows (SOFT EDGES), the fill and look-up checks, and the energy rows.
  { name: 'memories with the split and the fill open is the frame P0c-edge made (was eb960892, the slab)', preset: 'memories',
    a: { canopy_fill: 1, leaf_diffuse: 0.95 }, pin: '143e4d01' },
  // The gate, on the camera that grew a branch: leaf_diffuse 0 is beamK 0 is the literal old composition in the else...
  { name: 'canopy 1 with leaf_diffuse 0 == absent (sky view)', preset: 'canopy 1', a: {}, b: { leaf_diffuse: 0 } },
  // ...with the whole P0c family armed behind it: the fill the sky view never reads, and sky_scatter, a live knob at 0 and the same
  // frame on both sides here (the pair differs in canopy_fill only)
  { name: 'the P0c family is inert on the sky camera at leaf_diffuse 0 (sky view)', preset: 'canopy 1',
    a: { leaf_diffuse: 0, sky_scatter: 0.5 }, b: { leaf_diffuse: 0, sky_scatter: 0.5, canopy_fill: 1 } },
  // sky_scatter is the retired proxy once the leaf is a lantern, exactly as fill_scatter is on the floor: a superseded knob is dead at d > 0
  { name: 'sky_scatter is inert once leaf_diffuse is up (sky view)', preset: 'canopy 1',
    a: { leaf_diffuse: 0.9, sky_scatter: 0.5 }, b: { leaf_diffuse: 0.9, sky_scatter: 0.0 } },
  // The other half: the split is a real switch on the sky camera, and sky_scatter was a real one before it.
  { name: 'leaf_diffuse changes the look-up frame (sky view)', preset: 'canopy 1', differ: true, a: { leaf_diffuse: 0 }, b: { leaf_diffuse: 0.9 } },
  { name: 'sky_scatter is live at leaf_diffuse 0 (sky view)', preset: 'canopy 1', differ: true, a: { leaf_diffuse: 0, sky_scatter: 0 }, b: { leaf_diffuse: 0, sky_scatter: 0.5 } },
  // The glow replaces the window, it does not vanish with it: with the light thrown away (the leaf's beam taken out and nothing put back)
  // the frame sits at x0.89 of the window's, with it x1.03 (canopy 1, mean level). The floor under the loss, not a fit to either.
  { name: 'the lantern keeps the light (sky view)', preset: 'canopy 1', lit: [0.95, 1.15], a: { leaf_diffuse: 0 }, b: { leaf_diffuse: 0.95 } },
  // Wood is a pure attenuator: with no leaves there is nothing to glow and nothing for a ballistic k to act on, so a bare grove is the same
  // frame at any leaf_diffuse (an eye ray that meets only wood emits exactly 0, and its disk is the sky's: tb = t).
  { name: 'a bare grove is one frame at any leaf_diffuse (sky view: wood never glows)', preset: 'canopy 1',
    a: { foliage_density: 0, leaf_diffuse: 0 }, b: { foliage_density: 0, leaf_diffuse: 0.95 } },
];

// THE SKY FILL vs ITS REFERENCE (§4.7). The bun tests hold komorebi-fill.js's laws; this holds the GLSL to it. Each row
// lets the engine bake a real fill, reads back the layers it read and the Tsky / S it wrote, rebuilds both at a scatter
// of texels in JS (bilinear taps, the bake's own heights, atmosphere and sun) and compares. The tolerance is the
// storage, not the algorithm: both targets are RGBA16F, whose rounding is ~2.4e-4 near 1 (half a ulp, and what is
// observed), so 2e-3 leaves headroom for fixed-point bilinear weights; a wrong ray, height, weight or sun path
// is one to two orders larger (each is mutation-tested: 0.02–0.4 off).
const FILL_CHECKS = [
  { name: 'memories — the layer path, K 16', preset: 'memories', over: { canopy_fill: 1, fill_scatter: 0.5 } },
  { name: 'memories — K 7 at 128 px (nothing here is a power of two)', preset: 'memories', over: { canopy_fill: 1, fill_scatter: 0.3, fill_directions: 7, fill_resolution: 128 } },
  { name: 'memories in autumn — a red canopy, per-channel', preset: 'memories', over: { canopy_fill: 1, fill_scatter: 0.5, phenology: 1, anthocyanin: 0.8 } },
  { name: 'park 1 — faithful: a low-res layer set at the grown heights', preset: 'park 1', rebake: true, over: { canopy_fill: 1, fill_scatter: 0.5 } },
  { name: 'curtain 1 — Tsky only, S handed albedo 0', preset: 'curtain 1', over: { canopy_fill: 1, fill_scatter: 0.5 } },
  { name: 'tent 1 — the enclosure forces the layer tier; Tsky only', preset: 'tent 1', over: { canopy_fill: 1, fill_scatter: 0.5 } },
  // A LEAF IS NOT A WINDOW (§4.5): the same checks with the split on — S is now the emitted t − tb, from the coverage in alpha, the
  // albedo knob is off (it is set here on purpose: if it leaked, the reference would not see it), and the cloth and the tent read S
  { name: 'memories, leaf_diffuse 0.95 — the emission from alpha, albedo ignored', preset: 'memories', over: { canopy_fill: 1, fill_scatter: 0.5, leaf_diffuse: 0.95 } },
  { name: 'memories, leaf_diffuse 0.5 — K 7 at 128 px', preset: 'memories', over: { canopy_fill: 1, leaf_diffuse: 0.5, fill_directions: 7, fill_resolution: 128 } },
  { name: 'memories in autumn, leaf_diffuse 0.95 — a red canopy, per-channel', preset: 'memories', over: { canopy_fill: 1, leaf_diffuse: 0.95, phenology: 1, anthocyanin: 0.8 } },
  { name: 'park 1, leaf_diffuse 0.95 — faithful: coverage from the low-res layer set', preset: 'park 1', rebake: true, over: { canopy_fill: 1, leaf_diffuse: 0.95 } },
  { name: 'curtain 1, leaf_diffuse 0.95 — S is computed for the cloth too', preset: 'curtain 1', over: { canopy_fill: 1, leaf_diffuse: 0.95 } },
  { name: 'tent 1, leaf_diffuse 0.95 — and for the tent', preset: 'tent 1', over: { canopy_fill: 1, leaf_diffuse: 0.95 } },
];
// THE FILL'S BOOKKEEPING (§4.7), measured on the layers the engine really baked (__fillCheck's `energy`). No light is made or lost
// globally — what a frame shows is DISPLACEMENT (glow under the crown, shadow down-sun) — but the fill had two real breaks, and these
// rows are what they looked like: the fill lit its leaves along the REAL sun while the beam it balances has no bulk shift in the park
// (it emitted ~14% more than the beam gave up at a 36° sun), and it read its hemisphere through a box with CLAMP_TO_EDGE (it lost a
// large share of the glow that spreads past the box, and repeated the border texel to the horizon). Four numbers per look, all on one
// midpoint grid of emitters over the box and through the engine's own interpolation:
//   E      what the leaves emit, per layer and summed, BEFORE it descends through the layers below
//   R      what reaches the floor of it, the K hemisphere rays descending on the layers' true t — in an open world (Ropen), and the share of
//          it that lands inside the fill frame (Rin)
//   D_beam what the beam gives up, per floor column (the endless park: its columns are the box, its sun path vertical)
//   Reng   what the ENGINE's fill texture holds, Σ S · texel area over its whole frame
//   park   the endless park wraps its box: everything lands, so Reng = R whatever the stack (the closure row). ONE LAYER has nothing below
//          it, so R = E and that is the bottom layer's received light equal to its emitted light. Against the beam's deficit D_beam it
//          differs by the canopy's clumping alone — the hemisphere descends through the layers below by other paths than the sun's ray — so
//          that is a physics band (−5%…+15%, both ways), not an identity.
//   tree   a finite tree has open sky around it and a padded frame: nearly all of R lands inside the frame (a cosine kernel's tail past 3 h
//          is ~10% of a leaf's light at the very edge of the box, far less in all), and the glow has DECAYED by the frame's edge instead of
//          plateauing at a clamped border.
// The engine's S is a POINT-SAMPLED estimate (K rays per texel of a leaf-scale field), so against the forward integral it carries a floor:
// measured 0.15–0.4% on the bottom-layer rows and ≤ 1.2% on the finite looks' wide, coarse frames, with the shader equal to
// komorebi-fill.js's reference over the whole frame to 7 digits and the scatter and gather forms of one ray equal to 1e-13. (The forward
// side's emitter grid is a PRIME count over the box — a grid commensurate with the layer texture samples every cell at the same sub-texel
// phase, where the interpolated field is not its average, and read 2–25% off; stable under refinement, so it looked like a leak.)
const FILL_ENERGY = [
  { name: 'memories, one layer — the bottom layer received what it emitted (wrap)', preset: 'memories', kind: 'bottom', over: { canopy_fill: 1, leaf_diffuse: 0.95, layer_count: 1 } },
  { name: 'afternoon 7, one layer — the bottom layer received what it emitted (wrap)', preset: 'afternoon 7', kind: 'bottom', over: { canopy_fill: 1, leaf_diffuse: 0.95, layer_count: 1 } },
  { name: 'memories — the fill holds what the leaves sent down, and what the beam gave up (park, one sun)', preset: 'memories', kind: 'park', over: { canopy_fill: 1, leaf_diffuse: 0.95 } },
  { name: 'afternoon 7 — the fill holds what the leaves sent down, and what the beam gave up (park, one sun)', preset: 'afternoon 7', kind: 'park', over: { canopy_fill: 1, leaf_diffuse: 0.95 } },
  { name: 'park 1 — a finite tree: what it sends down lands inside the padded frame, and decays', preset: 'park 1', kind: 'tree', rebake: true, over: { canopy_fill: 1, leaf_diffuse: 0.95 } },
  { name: 'tent 1 — a finite tree: what it sends down lands inside the padded frame, and decays', preset: 'tent 1', kind: 'tree', over: { canopy_fill: 1, leaf_diffuse: 0.95 } },
  { name: 'curtain 1 — a finite tree: what it sends down lands inside the padded frame, and decays', preset: 'curtain 1', kind: 'tree', over: { canopy_fill: 1, leaf_diffuse: 0.95 } },
];
const ENERGY_BOTTOM = 0.01, ENERGY_CLOSE = 0.015, ENERGY_BEAM = [0.95, 1.15], ENERGY_IN_FRAME = 0.9, ENERGY_TREE_NOISE = 0.02, ENERGY_DECAY = 0.1;
// leaf_diffuse (and with it k) changed on a RUNNING engine, nothing rebuilt (it tweens, so a transition and a slider both do this):
// the frame must be the one an engine made with the knob already there shows. The fill's signature carries k so S re-bakes, and on
// the faithful path the cast has k baked in, so a frame that kept the old cast would look like the knob did nothing.
const LIVE_CHANGES = [
  { name: 'memories (layer path: the tap reads it, the fill re-bakes)', preset: 'memories', over: { canopy_fill: 1 }, key: 'leaf_diffuse', value: 0.95 },
  { name: 'park 1 with the fill shut (faithful: the cast is re-cast, nothing else moves)', preset: 'park 1', rebake: true, over: { canopy_fill: 0 }, key: 'leaf_diffuse', value: 0.95 },
  { name: 'park 1 with the fill open (faithful: the cast AND the fill)', preset: 'park 1', rebake: true, over: { canopy_fill: 1 }, key: 'leaf_diffuse', value: 0.95 },
  // THE CARPET (§4.7) is noticed at draw time, not baked at a regrow the engine does not run when a slider moves: opened on a running engine it must be the
  // frame an engine born with it shows, and the authored wind direction — a MORPH key, tweened in a transition — must carry it there too
  { name: 'afternoon 7 (the carpet bakes when the gate opens)', preset: 'afternoon 7', over: { leaf_drop: 1, phenology: 0.9 }, key: 'litter', value: 1, litter: true },
  { name: 'park 1 (faithful: the carpet bakes when the gate opens)', preset: 'park 1', rebake: true, over: { leaf_drop: 1, phenology: 0.9 }, key: 'litter', value: 1, litter: true },
  { name: 'park 1 (the season turns its wind: the carpet is carried again)', preset: 'park 1', rebake: true, over: { leaf_drop: 1, phenology: 0.9, litter: 1, wind_direction_deg: 20 }, key: 'wind_direction_deg', value: 200, litter: true },
  { name: 'afternoon 7 (the season moves and the grove regrows: the carpet follows it, fresher and more of it)', preset: 'afternoon 7', over: { leaf_drop: 1, phenology: 0.8, litter: 1 }, key: 'phenology', value: 0.95, apply: 'canopy', litter: true },
  // (the same leaves, fallen on the same days, in another colour: nothing the carpet's signature holds has moved but the grove itself, which a regrow makes anew)
  { name: 'afternoon 7 (the grove regrows with the same leaves fallen in another colour: the carpet is re-laid)', preset: 'afternoon 7', over: { leaf_drop: 1, phenology: 0.9, litter: 1, anthocyanin: 0.8, turn_exposure: 1 }, key: 'anthocyanin', value: 0.2, apply: 'canopy', litter: true },
];
// canopy_fill crossed on a RUNNING engine (it tweens, so nothing rebuilds when it does). `sky: true` = the camera has no
// surface to light, so the fill must stay unallocated and the frame must not move.
const FILL_TOGGLES = [
  { name: 'memories', preset: 'memories', over: { fill_scatter: 0.3 } },
  { name: 'park 1 (faithful: the low-res layers come and go with it)', preset: 'park 1', rebake: true, over: { fill_scatter: 0.3 } },
  { name: 'curtain 1', preset: 'curtain 1', over: {} },
  { name: 'tent 1', preset: 'tent 1', over: {} },
  { name: 'canopy 1 (the sky view: never allocates)', preset: 'canopy 1', sky: true, over: { fill_scatter: 0.3 } },
];
const FILL_TOL = 2e-3;

// THE LITTER CARPET vs THE GROVE'S OWN LIST (§4.7, P3b). Each row lets the engine bake a real carpet (frozen motion), reads the RGBA8 texture back, and holds it to the
// same leaves through komorebi-litter.js's pure functions (see __litterCheck for what each number is): the FRAME (the fill's, recomputed from the params), the STAMPS the
// bake was handed (every one of them), the RASTER (a CPU painting of those stamps in drop order, against the GPU's, with the reverse order's painting as the yardstick: the
// last to fall lie on top, and the GPU must agree with the right order by far less than the two orders disagree with each other), the closed forms on a SPARSE carpet
// (area and mean colour, so the raster is not agreeing with a bug it shares) and — on a finite tree — the DRIFT. `passes` 1 is "once per regrow" measured on the running
// engine. The bun tests hold that the buffer is litterInstances in drop order; these hold that the GPU turned the buffer into the floor.
const FALL_LOOK = { leaf_drop: 1, phenology: 0.9, anthocyanin: 0.8, turn_exposure: 1, canopy_fill: 1, litter: 1 };
const LITTER_CHECKS = [
  { name: 'afternoon 7 at 0.9 — the endless park: the box, wrapped, a dense carpet', preset: 'afternoon 7', over: { ...FALL_LOOK } },
  { name: 'afternoon 7 at 0.9, 512 px, the fill shut (the carpet is read whether or not canopy_fill is open)', preset: 'afternoon 7', over: { ...FALL_LOOK, canopy_fill: 0, litter_resolution: 512 } },
  { name: 'afternoon 7 on the first day of the fall — a sparse carpet: the closed forms', preset: 'afternoon 7', over: { ...FALL_LOOK, phenology: 0.71 }, sparse: true },
  { name: 'park 1 at 0.9 — a finite tree: the padded frame, clamped, and the drift down-wind', preset: 'park 1', over: { ...FALL_LOOK }, drift: true },
  { name: 'park 1 at 0.9, the season blowing the other way', preset: 'park 1', over: { ...FALL_LOOK, wind_direction_deg: 215, litter_drift_m: 0.8 }, drift: true },
];
// (the rim's one-texel anti-aliasing ramp over-counts a leaf's area by π·w²/12 — a few % of a 5-texel leaf, ~20% of one under a texel — and overlap takes it back on a carpet
// that thickens: so the sparse carpet's area is within a few % of Σπ·A·B0·fade, and no carpet is over it by more than the ramp's own bias)
const LITTER_RASTER = { alpha: 0.02, rgb: 0.02, area: [0.97, 1.03], vsOrder: 0.25 }, LITTER_SPARSE = { area: [0.9, 1.05], mean: 0.12 }, LITTER_OVER = 1.1, LITTER_DRIFT = { angleDeg: 20, len: 0.25 };
// THE STAMP (VS_LITTER/FS_LITTER as the engine compiles them) against arithmetic: see __litterStamp.
const LITTER_STAMP_TOL = 0.02;

// THE LANTERN's RAY vs ITS REFERENCE (§4.9). The same GLSL snippet the fill check holds, but the sky camera's half of it: readWood TRUE, the
// wood read from the layer's own R16F texture, T_src (the beam: a leaf kills the disk) and the glow through wood, on the layers and wood the
// engine really baked (__skyCheck). Every sky look at the three d that matter: 0 (the window: Tb is T, L is the P0b proxy), 0.5, and the
// physical 0.95 (k ~ 3: a unit of coverage keeps 5% of the disk). The tolerance is the storage, as FILL_TOL is: the layers are half float and
// the reference interpolates the readback in float64, which is ~2e-4 observed at worst; a wrong wood read, sun path, throughput or beam is
// 0.06-0.8 off (each is mutation-tested: wood in the emission, the beam ignoring coverage, a sun path that ignores wood). Each row also has to MEASURE something: rays whose disk a leaf killed, rays with a lit leaf, rays
// the wood is in the way of, and wood in the texture at all.
const SKY_CHECKS = ['canopy 1', 'canopy 2', 'canopy 3', 'canopy 4'].flatMap((preset) => [0, 0.5, 0.95].map((d) => ({ name: `${preset}, leaf_diffuse ${d}`, preset, over: { leaf_diffuse: d } })));
const SKY_TOL = 1e-3;

// A TEXEL IS A MIXTURE, NOT A SLAB (§4.5, P0c-edge). The bake stores Σ τ·cov and Σ cov; read as a slab of depth τ the pair is Jensen-dark at a soft edge, and
// nearly half of every leaf's area is soft edge (edge_softness 0.26 → 44%). It showed in two places, and each has a row that is a MEASUREMENT of the shader the
// engine compiles, on the layers it baked, never a restatement of the formula:
//   THE RIM (the lantern, sky view): a leaf's edge glowed up to x2.3 (blue) of its own interior — a cream outline round every leaf on canopy 1 at leaf_diffuse
//     0.95. Measured on rays that see ONE leaf's glow alone (the top layer covers, everything under it is clear: thr = 1, A = 1), classified by the readback's
//     coverage: the peak of (soft-edge glow / mean interior glow), the worst channel. A mixture's edge glow is its area share of the interior's, so it cannot
//     pass 1; the row allows 1.1 for the storage and the c = 0.98 end of "interior".
//   THE HALO (the floor, cast taps): the beam through an edge texel was e^(−τ − k·c) of a texel that is mostly open sky — 0.18 where the mixture gives 0.70
//     (c 0.3, blue) — a dark ring round every ballistic leaf shadow. `tap` and `tapCA` exactly as the cast cameras carry them, at every texel centre of every baked
//     layer (and the diffraction read at a dispersed position, where the bilinear weights are real): no darker than the mixture of the same texel, and in the soft-edge
//     band the shader's mean equals the mixture's. `slab` is the old answer, reported as the depth of the halo the row would have seen.
//   THE FAITHFUL STAMP (park 1, curtain 1): FS_FAITH drawn for one leaf, every pixel held to (1 − cf) + cf·e^(−τ_leaf − k), cf = cov·fade — whole, half faded, and
//     too faint to exist (exactly clear, and finite: vTau/vFade is never formed).
const RIM_CHECKS = [{ name: 'canopy 1, leaf_diffuse 0.95', preset: 'canopy 1', over: { leaf_diffuse: 0.95 } }];
const RIM_MAX = 1.1, RIM_MIN_TEXELS = 300;
const HALO_CHECKS = [
  { name: 'afternoon 7, leaf_diffuse 0.95 (the layer floor, blue τ 6.9)', preset: 'afternoon 7', over: { leaf_diffuse: 0.95 } },
  { name: 'memories, leaf_diffuse 0.95 (the layer floor)', preset: 'memories', over: { leaf_diffuse: 0.95 } },
];
const HALO_TOL = 2e-3, HALO_BAND = [0.99, 1.01], HALO_MIN_TEXELS = 500, STAMP_TOL = 2e-5;

// Suite 4 as data: one row per transition ROUTING tier. transitionTo classifies the from->to diff into a
// tier, and each tier drives different code — the grove crossfade grows a SECOND grove (buildTargetGrove),
// the mode flip swaps the camera — so a crash or a mis-routed tier is invisible to every frozen-frame suite
// above (none of them ever call transitionTo; a missing-import crash on exactly the crossfade path once
// survived all of them). `over` merges over the `to` preset; the assertion is the engine's own routing
// verdict (trans.crossfade/structDiff, read right after transitionTo) plus onEnd fired and GL stayed clean.
// 'memories' is the base because the crossfade gate needs branch_tau 0 + non-faithful at both ends.
// ---------------------------------------------------------------------------
const TRANSITION_ROUTES = [
  { name: 'live morph stays non-structural', from: 'memories', to: 'memories',
    over: { sun_azimuth_deg: 123, sun_elevation_deg: 47 },
    expect: { crossfade: false, structDiff: false } },
  { name: 'seed-only topology diff takes the grove crossfade', from: 'memories', to: 'memories',
    over: { seed: 1234567 },
    expect: { crossfade: true, structDiff: true } },
  { name: 'wood at the target end closes the crossfade gate', from: 'memories', to: 'memories',
    over: { seed: 7654321, branch_tau: 0.5 },
    expect: { crossfade: false, structDiff: true } },
  { name: 'camera flip routes as a mode transition', from: 'memories', to: 'canopy 1',
    over: {},
    expect: { crossfade: false, structDiff: true } },
  // a hard param swap landing MID-crossfade must abort it cleanly (the observed failure: the incoming grove
  // kept baking against layer state the swap's rebuild had replaced — a dangling-VAO crash). onEnd must NOT
  // fire (the route was abandoned, not completed) and the engine must keep rendering after.
  { name: 'setParams mid-crossfade aborts it cleanly', from: 'memories', to: 'memories',
    over: { seed: 1234567 }, interrupt: { at: 0.35, with: 'morning 1' },
    expect: { crossfade: true, structDiff: true } },
];

// Suite 3: two independently created engines on the same frozen look must land on the same bytes.
// One look per camera: the floor (park 1), the curtain (curtain 1), the layer path (memories), the sky view
// (canopy 1) — the capture road has to be proven on the branch whose pixels are being read, not only the others.
const DETERMINISM = ['park 1', 'curtain 1', 'memories', 'canopy 1'];

// ---------------------------------------------------------------------------
// A ~20-line static file server over the repo root. Deliberately not the bun dev server: this harness must
// run off plain node so it never drags bun into its own dependency story.
// ---------------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function serveRoot() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (file !== ROOT && !file.startsWith(`${ROOT}/`)) { res.writeHead(403).end('forbidden'); return; }
    try {
      if (!(await stat(file)).isFile()) throw new Error('not a file');
    } catch { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => { server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })); });
}

// ---------------------------------------------------------------------------
const results = [];
const log = (...a) => console.log(...a);
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
const record = (suite, name, pass, detail) => { results.push({ suite, name, pass, detail }); };

async function writePNG(name, dataURL) {
  const file = join(OUT, `${name}.png`);
  await writeFile(file, Buffer.from(dataURL.split(',')[1], 'base64'));
  return file;
}

// ---- suite 5: host failure + context loss (the --robust flag runs just this) ----
async function robustness(page) {
  log('\nROBUSTNESS — a throwing onFrame keeps the loop alive; context loss recovers on its own');
  for (const [label, over] of [['plain path', { adaptive_motion: false }], ['adaptive skip path', { adaptive_motion: true, adaptive_idle_fps: 1 }], ['adaptive heavy path', { adaptive_motion: true, adaptive_idle_fps: 1000 }]]) {
    const name = `onFrame throw does not stop the loop (${label})`;
    try {
      const r = await page.evaluate(([o]) => window.__onFrameThrows('park 1', o, 6), [over]);
      const bad = [];
      if (r.calls < 6) bad.push(`loop stopped after ${r.calls} onFrame call(s)`);
      if (r.surfaced < Math.min(r.calls, 2)) bad.push(`host error swallowed (${r.surfaced} surfaced / ${r.calls} calls)`);
      record('robustness', name, bad.length === 0, bad.join('; ') || `${r.calls} calls, ${r.surfaced} errors surfaced`);
      log(`  ${bad.length ? 'FAIL' : 'ok  '}  ${name.padEnd(58)} ${bad.join('; ') || `${r.calls} calls, ${r.surfaced} surfaced`}`);
    } catch (e) { record('robustness', name, false, e.message.split('\n')[0]); log(`  FAIL  ${name} — ${e.message.split('\n')[0]}`); }
  }
  const LOSS = [
    ...DETERMINISM.map((p) => ({ name: `${p} recovers byte-identical`, preset: p, opts: {} })),
    // the sky fill (§4.7) owns GL objects no shipped look ever creates — a program, two textures, an FBO, and on the
    // faithful path a resized layer set — so a restore that forgot them would pass every row above
    { name: 'memories with the sky fill open recovers byte-identical', preset: 'memories', opts: { over: { canopy_fill: 1, fill_scatter: 0.5 } } },
    { name: 'park 1 (faithful) with the sky fill open recovers byte-identical', preset: 'park 1', opts: { over: { canopy_fill: 1, fill_scatter: 0.5 } } },
    // the litter carpet (§4.7) owns a texture, a program, a VAO and a buffer that a lost context kills too — and its bake is NOTICED at draw time, so a
    // restore that forgot them would only show as a floor without its leaves: the pre-loss frame has the carpet, so the post-restore one must
    { name: 'afternoon 7 with the litter carpet recovers byte-identical', preset: 'afternoon 7', opts: { over: { leaf_drop: 1, phenology: 0.9, litter: 1 } } },
    { name: 'park 1 (faithful) with the litter carpet and the fill recovers byte-identical', preset: 'park 1', opts: { over: { leaf_drop: 1, phenology: 0.9, litter: 1, canopy_fill: 1 } } },
    { name: 'recovers from the CURRENT params, not the create-time ones', preset: 'park 1', opts: { retarget: 'memories' } },
    { name: 'paused stays paused across loss + restore', preset: 'memories', opts: { pause: true } },
    { name: 'loss mid-transition recovers and the route settles', preset: 'memories', opts: { transition: true } },
  ];
  for (const c of LOSS) {
    const name = `context loss: ${c.name}`;
    try {
      const r = await page.evaluate(([p, o]) => window.__contextLoss(p, o), [c.preset, c.opts]);
      const bad = [];
      if (!r.lostPrevented) bad.push('webglcontextlost not preventDefault()ed');
      if (r.ticksWhileLost > 1) bad.push(`${r.ticksWhileLost} frames ran while the context was lost`);
      if (r.isLostAfter) bad.push('context still lost after restore');
      if (r.after.glError || r.glErrorEnd) bad.push(`gl.getError 0x${(r.after.glError || r.glErrorEnd).toString(16)}`);
      const s = r.after.stats;
      if (!(s.variance > 1)) bad.push(`flat frame after restore (variance ${s.variance.toFixed(3)})`);
      if (!s.opaque) bad.push('non-opaque frame after restore');
      if (r.diff && !r.diff.equal) bad.push(`${r.diff.diffPixels}/${r.diff.total} px differ from the pre-loss frame (max Δ${r.diff.maxDelta})`);
      if (c.opts.pause && r.ticksWhilePaused > 0) bad.push(`${r.ticksWhilePaused} frames ran while paused after restore`);
      if (r.rateAfter.calls > r.rateAfter.rafs + 1) bad.push(`duplicate loop: ${r.rateAfter.calls} onFrame calls in ${r.rateAfter.rafs} rAFs (was ${r.rateBefore.calls})`);
      if (r.rateAfter.calls < 1) bad.push('loop did not resume');
      if (r.diff && !r.diff.equal) {
        await writePNG(`diff-loss-${slug(c.name)}`, r.diff.png);
        await writePNG(`loss-${slug(c.name)}-before`, await page.evaluate((id) => window.__png(id), r.before.id));
        await writePNG(`loss-${slug(c.name)}-after`, await page.evaluate((id) => window.__png(id), r.after.id));
      }
      record('robustness', name, bad.length === 0, bad.join('; ') || `identical, 1 loop (${r.rateAfter.calls} calls / ${r.rateAfter.rafs} rAFs), events ${r.events.join(',')}`);
      log(`  ${bad.length ? 'FAIL' : 'ok  '}  ${name.padEnd(70)} ${bad.join('; ') || `${r.rateAfter.calls}/${r.rateAfter.rafs} calls per rAF`}`);
    } catch (e) { record('robustness', name, false, e.message.split('\n')[0]); log(`  FAIL  ${name} — ${e.message.split('\n')[0]}`); }
  }
  {
    const name = 'dispose() is not a loss: no recovery, no frames, listeners removed';
    try {
      const r = await page.evaluate(() => window.__disposeNoRecovery());
      const bad = [];
      if (!r.listenersAdded.includes('webglcontextlost') || !r.listenersAdded.includes('webglcontextrestored')) bad.push(`context listeners not registered (${r.listenersAdded.join(',') || 'none'})`);
      if (r.unremoved.length) bad.push(`listeners left after dispose: ${r.unremoved.join(',')}`);
      if (r.lostPrevented) bad.push('dispose-triggered loss was preventDefault()ed (would be restored)');
      if (r.restored || !r.stillLost) bad.push('context came back after dispose');
      if (r.ticksAfterDispose) bad.push(`${r.ticksAfterDispose} frames after dispose`);
      record('robustness', name, bad.length === 0, bad.join('; ') || `listeners ${r.listenersAdded.join(',')} removed`);
      log(`  ${bad.length ? 'FAIL' : 'ok  '}  ${name.padEnd(70)} ${bad.join('; ')}`);
    } catch (e) { record('robustness', name, false, e.message.split('\n')[0]); log(`  FAIL  ${name} — ${e.message.split('\n')[0]}`); }
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const { server, port } = await serveRoot();
  const browser = await chromium.launch({
    // SwiftShader/ANGLE is the whole reason this works headless: a real WebGL2 ES 3.00 implementation with
    // EXT_color_buffer_float, and a software rasteriser, so the same bytes come out on any machine.
    // --enable-unsafe-swiftshader is what recent Chrome requires to allow the software fallback for WebGL.
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
  });
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 640, height: 400 } });
  page.setDefaultTimeout(300000);
  page.on('pageerror', (e) => { if (!e.message.includes('komorebi-test-')) log(`  [page error] ${e.message}`); });   // komorebi-test-* = a deliberate host throw
  page.on('console', (m) => { if (m.type() === 'error') log(`  [console] ${m.text()}`); });

  let failures = 0;
  try {
    await page.goto(`http://127.0.0.1:${port}/test-gl/harness.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true);

    // ---- preflight: fail loudly, with the fix, rather than letting create() throw twenty times ----
    const info = await page.evaluate(() => window.__glinfo());
    if (!info.webgl2 || !info.colorBufferFloat) {
      log('\nFATAL — headless Chromium did not come up with the context this engine requires.');
      log(`  webgl2: ${!!info.webgl2}   EXT_color_buffer_float: ${!!info.colorBufferFloat}`);
      log('  komorebi\'s create() hard-requires both. Fix: make sure the SwiftShader flags in this file');
      log('  reach Chromium — --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader — and that');
      log('  the browser is the Playwright-managed one (npx playwright install chromium).');
      await browser.close(); server.close();
      process.exit(1);
    }
    log(`WebGL2  ${info.version}`);
    log(`        ${info.glsl}`);
    log(`        renderer: ${info.renderer}   EXT_color_buffer_float: yes   EXT_float_blend: ${info.floatBlend ? 'yes' : 'no'}   dpr: ${info.dpr}`);

    // ---- suite 4 (opt-in): TRANSITIONS ----
    // `node run.js --transition "afternoon 7" "canopy 1"` — deliberately NOT part of the default run, because
    // unlike everything else here it is not byte-stable: the wind is live (a frozen transition is not a
    // transition) so two runs differ pixel for pixel. What it produces instead is a NUMBER — the largest
    // frame-to-frame step in mean luminance — and a contact sheet to look at. Repeat the route to see the
    // metric's own spread before reading much into a small change in it.
    if (process.argv[2] === '--transition') {
      const [from, to] = process.argv.slice(3);
      if (!from || !to) { log('usage: node run.js --transition "<from look>" "<to look>"'); await browser.close(); server.close(); process.exit(2); }
      const r = await page.evaluate(([a, b]) => window.__transition(a, b, {}), [from, to]);
      const f = r.frames;
      log(`\nTRANSITION — ${from} -> ${to}   ${r.info.structDiff ? 'STRUCTURAL (dissolve + rebuild under the bloom)' : 'live morph, no bloom'}${r.info.canopyMorph ? ' + grove morph' : ''}`);
      log(`  ${f.length} frames over ${r.ms} ms   (mean luminance is Rec.709 over the whole frame, 0-255)\n`);
      // Absolute churn is CONTRAST-BLIND, and the bloom spends contrast: at its peak the frame is pale, so a
      // wholesale rearrangement moves few grey levels. The normalized column divides by the frame's own spread
      // (√variance), which is the closer stand-in for what an eye adapted to that pale frame actually sees.
      log('   #      t   bloom  swap    luma     Δ   churn   /σ');
      let maxD = 0, maxAt = -1, swapAt = -1, swapD = 0, maxC = 0, maxCAt = -1, swapC = 0, maxN = 0, maxNAt = -1, swapN = 0;
      for (let i = 0; i < f.length; i++) {
        const d = i ? f[i].luma - f[i - 1].luma : 0;
        // trans.swapped flips at t>=0.5 on EVERY route; only a structural one actually swaps anything there.
        const justSwapped = r.info.structDiff && i > 0 && f[i].swapped && !f[i - 1].swapped;
        if (justSwapped) { swapAt = i; swapD = d; swapC = f[i].churn; }
        if (i && Math.abs(d) > Math.abs(maxD)) { maxD = d; maxAt = i; }
        if (i && f[i].churn > maxC) { maxC = f[i].churn; maxCAt = i; }
        const nrm = i ? f[i].churn / Math.max(1, Math.sqrt(f[i].variance)) : 0;
        if (i && nrm > maxN) { maxN = nrm; maxNAt = i; }
        if (justSwapped) swapN = nrm;
        log(`  ${String(i).padStart(2)}  ${f[i].t.toFixed(3)}  ${f[i].bloom.toFixed(3)}  ${justSwapped ? ' <<' : (f[i].swapped ? '  •' : '   ')}  ${f[i].luma.toFixed(2).padStart(7)}  ${(i ? (d >= 0 ? '+' : '') + d.toFixed(2) : '').padStart(7)}  ${(i ? f[i].churn.toFixed(2) : '').padStart(6)}  ${(i ? nrm.toFixed(3) : '').padStart(6)}`);
      }
      const file = join(OUT, `trans-${slug(from)}-${slug(to)}.png`);
      await writeFile(file, Buffer.from((await page.evaluate(([ids, c]) => window.__strip(ids, c), [f.map((x) => x.id), 8])).split(',')[1], 'base64'));
      log(`\n  max |ΔL| per frame   ${Math.abs(maxD).toFixed(2)}   at frame ${maxAt} (t=${f[maxAt] ? f[maxAt].t.toFixed(3) : '-'})`);
      log(`  max CHURN per frame  ${maxC.toFixed(2)}   at frame ${maxCAt} (t=${f[maxCAt] ? f[maxCAt].t.toFixed(3) : '-'})`);
      log(`  max CHURN/σ          ${maxN.toFixed(3)}   at frame ${maxNAt} (t=${f[maxNAt] ? f[maxNAt].t.toFixed(3) : '-'})`);
      if (swapAt >= 0) log(`  the swap frame       ${swapAt}: t=${f[swapAt].t.toFixed(3)}  bloom=${f[swapAt].bloom.toFixed(3)}  ΔL=${(swapD >= 0 ? '+' : '') + swapD.toFixed(2)}  churn=${swapC.toFixed(2)}  churn/σ=${swapN.toFixed(3)}`);
      else log('  the swap frame       none — this route morphs live, nothing is swapped');
      log(`  strip                ${file}`);
      await browser.close(); server.close();
      process.exit(0);
    }

    // ---- opt-in: LOOKS — `node run.js --look "<preset>" [--as <name>] key=value ... [--look ...]` (repeatable) ----
    // For eyes, not proof: one PNG per spec, the preset with the overrides merged on (values are JSON, so
    // phenology=0.75 and faithful_canopy=true both work), written to out/<name>.png. Unlike the suites it
    // re-bakes first (`rebake`), so a faithful look's frame is the real one and not the empty-sun-cloud first bake.
    // `--size 960x540` after a --look renders that one at that size (default 320x180, what every hash is taken at).
    if (process.argv[2] === '--look') {
      const specs = [];
      for (let i = 2; i < process.argv.length; i++) {
        const a = process.argv[i];
        if (a === '--look') specs.push({ preset: process.argv[++i], name: null, over: {}, size: null });
        else if (a === '--as') specs[specs.length - 1].name = process.argv[++i];
        else if (a === '--size') specs[specs.length - 1].size = process.argv[++i].split('x').map(Number);
        else { const [k, ...v] = a.split('='); specs[specs.length - 1].over[k] = JSON.parse(v.join('=')); }
      }
      for (const s of specs) {
        const name = s.name || slug(`${s.preset} ${Object.entries(s.over).map(([k, v]) => `${k} ${v}`).join(' ')}`);
        const r = await page.evaluate(([p, o, f, z]) => window.__run(p, o, [f], { rebake: true, size: z }), [s.preset, s.over, SMOKE_FRAMES, s.size || null]);
        log(`  ${await writePNG(name, await page.evaluate((id) => window.__png(id), r.captures[0].id))}   ${r.captures[0].hash}${r.glError ? `  gl.getError 0x${r.glError.toString(16)}` : ''}`);
      }
      await browser.close(); server.close();
      process.exit(0);
    }

    // ---- suite 1: smoke ----
    // Optional CLI filter (substring match on preset names, case-insensitive): renders only the matching
    // looks and SKIPS the gate/determinism suites — the fast authoring loop. No args = the full run.
    const robustOnly = process.argv[2] === '--robust';
    const gateOnly = process.argv[2] === '--gate';
    const fillOnly = process.argv[2] === '--fill';
    const skyOnly = process.argv[2] === '--sky';
    const edgeOnly = process.argv[2] === '--edge';
    const solo = robustOnly || gateOnly || fillOnly || skyOnly || edgeOnly;   // one suite, nothing else
    const gateFilters = gateOnly ? process.argv.slice(3).map((s) => s.toLowerCase()) : [];
    const filters = (gateOnly || fillOnly || skyOnly || edgeOnly) ? [] : process.argv.slice(2).filter((a) => a !== '--robust').map((s) => s.toLowerCase());
    const allPresets = await page.evaluate(() => window.__presets());
    const presets = solo ? [] : filters.length ? allPresets.filter((n) => filters.some((f) => n.toLowerCase().includes(f))) : allPresets;
    if (filters.length && presets.length === 0) { log(`no preset matches: ${filters.join(', ')}`); await browser.close(); server.close(); process.exit(1); }
    if (!solo) log(`\nSMOKE — ${presets.length} presets @ ${SMOKE_FRAMES} frames`);
    const truncated = [];   // groves that outgrew the woody-occluder table (§4.5) — see the note under the loop
    for (const name of presets) {
      let r;
      try {
        r = await page.evaluate(([p, f]) => window.__run(p, {}, [f]), [name, SMOKE_FRAMES]);
      } catch (e) {
        record('smoke', name, false, e.message.split('\n')[0]);
        log(`  FAIL  ${name} — ${e.message.split('\n')[0]}`);
        continue;
      }
      const c = r.captures[0];
      const s = c.stats;
      const bad = [];
      if (r.glError) bad.push(`gl.getError 0x${r.glError.toString(16)}`);
      if (!(s.variance > 1)) bad.push(`flat frame (variance ${s.variance.toFixed(3)})`);
      if (s.blackFrac === 1) bad.push('all-black frame');
      if (s.whiteFrac === 1) bad.push('all-white frame');
      if (!s.opaque) bad.push('non-opaque readback (alpha:false context should read 255)');
      // THE OCCLUDER CAP (§4.5). A grove that grows more level-≤1 segments than the table holds loses the tail of
      // the grow order — whole later trees render with no bole and no limbs. Nothing looks broken; there is just
      // less wood than the parameters asked for, which is why it went unnoticed for as long as it did. A pixel
      // cannot report it, so the engine does: `want` is what grew, `count` is what fits.
      const cut = r.occ ? r.occ.want - r.occ.count : 0;
      if (cut > 0) truncated.push(`${name} grew ${r.occ.want}, cap ${r.occ.cap} — ${cut} segments of wood dropped`);
      await writePNG(slug(name), await page.evaluate((id) => window.__png(id), c.id));   // out/<preset>.png — the look itself, the artifact this suite exists to produce
      record('smoke', name, bad.length === 0, bad.length ? bad.join('; ')
        : `${c.w}×${c.h} var ${s.variance.toFixed(0)} mean ${s.mean.toFixed(1)} ${r.ms} ms${cut > 0 ? `  WOOD TRUNCATED ${r.occ.want}>${r.occ.cap}` : ''}`);
      log(`  ${bad.length ? 'FAIL' : cut > 0 ? 'WARN' : 'ok  '}  ${name.padEnd(14)} var ${s.variance.toFixed(0).padStart(5)}  mean ${s.mean.toFixed(1).padStart(5)}  ${String(r.ms).padStart(6)} ms  ${bad.join('; ')}`);
    }
    // Loud, but deliberately not a FAILURE: the looks that hit the cap were authored against the truncation, so
    // what ships is what their author saw. Raising MAX_OCC would repaint them, which is a look decision. What this
    // guarantees is that the NEXT grove to outgrow the table says so on the first run instead of never.
    if (truncated.length) { log(`\n  WOOD TRUNCATED — the occluder table is full for these looks:`); for (const t of truncated) log(`    ${t}`); }

    // A filtered run is the fast authoring loop: the smoke renders above are its whole point,
    // and the stillness/determinism/gate suites only run on a full sweep.
    if (!filters.length && !robustOnly) {
    // ---- suite 3a: stillness — the proof that the capture road and the motion freeze are actually stable.
    // Two captures forty ticks apart out of ONE engine. If wind, weather, drift, the auto-quality governor
    // or the adaptive-fps present path were still moving anything, this is where it shows.
    if (!solo) log(`\nDETERMINISM — stillness (one engine, captures at ${STILL_FRAMES.join(' and ')})`);
    for (const name of solo ? [] : DETERMINISM) {
      const r = await page.evaluate(([p, f]) => window.__run(p, {}, f), [name, STILL_FRAMES]);
      const d = await page.evaluate(([x, y]) => window.__diff(x, y), [r.captures[0].id, r.captures[1].id]);
      record('determinism', `${name} holds still`, d.equal, d.equal ? `hash ${r.captures[0].hash}` : `${d.diffPixels}/${d.total} px differ, max Δ${d.maxDelta}`);
      log(`  ${d.equal ? 'ok  ' : 'FAIL'}  ${name.padEnd(14)} hash ${r.captures[0].hash}  ${d.equal ? '' : `${d.diffPixels} px differ (max Δ${d.maxDelta})`}`);
      if (!d.equal) await writePNG(`diff-still-${slug(name)}`, d.png);
    }

    // ---- suite 3b: two independent engines ----
    if (!solo) log('\nDETERMINISM — two independent engines, same look');
    for (const name of solo ? [] : DETERMINISM) {
      const a = await page.evaluate(([p, f]) => window.__run(p, {}, [f]), [name, GATE_FRAMES]);
      const b = await page.evaluate(([p, f]) => window.__run(p, {}, [f]), [name, GATE_FRAMES]);
      const d = await page.evaluate(([x, y]) => window.__diff(x, y), [a.captures[0].id, b.captures[0].id]);
      record('determinism', `${name} reproduces`, d.equal, d.equal ? `hash ${a.captures[0].hash}` : `${d.diffPixels}/${d.total} px differ, max Δ${d.maxDelta}`);
      log(`  ${d.equal ? 'ok  ' : 'FAIL'}  ${name.padEnd(14)} ${a.captures[0].hash} vs ${b.captures[0].hash}  ${d.equal ? '' : `${d.diffPixels} px differ (max Δ${d.maxDelta})`}`);
      if (!d.equal) await writePNG(`diff-repro-${slug(name)}`, d.png);
    }

    // ---- suite 2: the gate invariants ----
    if (!fillOnly && !skyOnly && !edgeOnly) log(`\nGATE INVARIANTS — byte-identical off-paths @ ${GATE_FRAMES} frames`);
    for (const inv of (fillOnly || skyOnly || edgeOnly) ? [] : INVARIANTS.filter((r) => !gateFilters.length || gateFilters.some((f) => r.name.toLowerCase().includes(f)))) {
      const opts = inv.rebake ? { rebake: true } : undefined;
      const a = await page.evaluate(([p, o, f, q]) => window.__run(p, o, [f], q), [inv.preset, inv.a || {}, GATE_FRAMES, opts]);
      if (inv.pin) {   // a PIN row: one frame, one number written down before the change (see INVARIANTS)
        const got = a.captures[0].hash, ok = !a.glError && got === inv.pin;
        record('gate', inv.name, ok, ok ? `pinned (${got})` : a.glError ? `gl.getError 0x${a.glError.toString(16)}` : `hash ${got}, pinned ${inv.pin} — the frame moved`);
        log(`  ${ok ? 'ok  ' : 'FAIL'}  [${inv.preset}] ${inv.name}${ok ? `   ${got}` : a.glError ? `   gl.getError 0x${a.glError.toString(16)}` : `   hash ${got}, pinned ${inv.pin}`}`);
        continue;
      }
      const b = await page.evaluate(([p, o, f, q]) => window.__run(p, o, [f], q), [inv.preset, inv.b, GATE_FRAMES, opts]);
      const d = await page.evaluate(([x, y]) => window.__diff(x, y), [a.captures[0].id, b.captures[0].id]);
      const tag = inv.known ? 'KNOWN-FAIL' : 'FAIL';
      if (inv.near != null) {   // a CONTINUITY row: a hair's step moves the picture by a hair
        const gl = a.glError || b.glError, ok = !gl && (d.equal || d.maxDelta <= inv.near);
        record('gate', inv.name, ok, ok ? `max Δ${d.equal ? 0 : d.maxDelta} <= ${inv.near} (${d.equal ? 0 : d.diffPixels}/${d.total ?? 0} px differ)` : gl ? `gl.getError 0x${gl.toString(16)}` : `max Δ${d.maxDelta} over ${inv.near}: ${d.diffPixels}/${d.total} px moved, first at ${d.firstAt} — it pops`);
        log(`  ${ok ? 'ok  ' : 'FAIL'}  [${inv.preset}] ${inv.name}${ok ? `   max Δ${d.equal ? 0 : d.maxDelta}` : gl ? `   gl.getError 0x${gl.toString(16)}` : `   max Δ${d.maxDelta} (want <= ${inv.near})`}`);
        continue;
      }
      if (inv.lit) {   // an ENERGY row: the frames differ, and b is neither dark nor blown relative to a
        const gl = a.glError || b.glError, ratio = b.captures[0].stats.mean / a.captures[0].stats.mean;
        const ok = !d.equal && !gl && ratio >= inv.lit[0] && ratio <= inv.lit[1];
        record('gate', inv.name, ok, ok ? `mean level ×${ratio.toFixed(3)} (${a.captures[0].stats.mean.toFixed(1)} -> ${b.captures[0].stats.mean.toFixed(1)}), within ×${inv.lit.join('..×')}`
          : gl ? `gl.getError 0x${gl.toString(16)}` : d.equal ? `frames IDENTICAL (${a.captures[0].hash}) — the split does nothing` : `mean level ×${ratio.toFixed(3)} is outside ×${inv.lit.join('..×')}`);
        log(`  ${ok ? 'ok  ' : 'FAIL'}  [${inv.preset}] ${inv.name}${ok ? `   ×${ratio.toFixed(3)}` : gl ? `   gl.getError 0x${gl.toString(16)}` : `   ×${ratio.toFixed(3)} (want ×${inv.lit.join('..×')})`}`);
        continue;
      }
      if (inv.differ) {   // a LIVE row: the frames must differ, and the engine must have stayed GL-clean doing it
        const gl = a.glError || b.glError;
        const ok = !d.equal && !gl;
        record('gate', inv.name, ok, ok ? `differ (${a.captures[0].hash} vs ${b.captures[0].hash}), ${d.diffPixels}/${d.total} px, max Δ${d.maxDelta}`
          : gl ? `gl.getError 0x${gl.toString(16)}` : `frames IDENTICAL (${a.captures[0].hash}) — the gate is not a switch`);
        log(`  ${ok ? 'ok  ' : 'FAIL'}  [${inv.preset}] ${inv.name}${ok ? '' : gl ? `   gl.getError 0x${gl.toString(16)}` : '   frames identical — the gate does nothing'}`);
        continue;
      }
      if (!d.equal) {
        await writePNG(`gate-${slug(inv.name)}-a`, await page.evaluate((id) => window.__png(id), a.captures[0].id));
        await writePNG(`gate-${slug(inv.name)}-b`, await page.evaluate((id) => window.__png(id), b.captures[0].id));
        await writePNG(`diff-${slug(inv.name)}`, d.png);
      }
      record('gate', inv.name, d.equal || !!inv.known,
        d.equal ? `identical (${a.captures[0].hash})` : `${d.diffPixels}/${d.total} px differ, max Δ${d.maxDelta}, first at ${d.firstAt}${inv.known ? ` — known: ${inv.known}` : ''}`);
      log(`  ${d.equal ? 'ok  ' : tag}  [${inv.preset}] ${inv.name}`);
      if (!d.equal) log(`        ${d.diffPixels}/${d.total} px differ, max Δ${d.maxDelta}, first at (${d.firstAt}) — see out/diff-${slug(inv.name)}.png`);
    }

    // ---- suite 2b: the sky fill's shader against its reference ----
    if (!gateOnly && !robustOnly && !skyOnly && !edgeOnly) log('\nSKY FILL — the shader against komorebi-fill.js, on the layers the engine baked');
    for (const c of (gateOnly || robustOnly || skyOnly || edgeOnly) ? [] : FILL_CHECKS) {
      let r;
      try {
        r = await page.evaluate(([p, o, q]) => window.__fillCheck(p, o, q), [c.preset, c.over, { rebake: !!c.rebake }]);
      } catch (e) { record('fill', c.name, false, e.message.split('\n')[0]); log(`  FAIL  ${c.name} — ${e.message.split('\n')[0]}`); continue; }
      const bad = [];
      if (r.errT > FILL_TOL) bad.push(`Tsky off by ${r.errT.toExponential(2)}`);
      if (r.errS > FILL_TOL) bad.push(`S off by ${r.errS.toExponential(2)}`);
      if (!(r.maxT > r.minT + 1e-3)) bad.push(`Tsky is flat (${r.minT.toFixed(4)}..${r.maxT.toFixed(4)}): nothing was measured`);
      if (c.over.leaf_diffuse > 0 && !(r.maxS > 0.01)) bad.push(`S is empty (max ${r.maxS.toFixed(4)}) with the split on: nothing was measured`);
      const detail = `${r.beamK > 0 ? `k ${r.beamK.toFixed(2)}  ` : ''}errT ${r.errT.toExponential(1)} errS ${r.errS.toExponential(1)}  Tsky ${r.minT.toFixed(2)}..${r.maxT.toFixed(2)} mean ${r.meanT.toFixed(3)}  S mean ${r.meanS.toFixed(3)}  texel-to-texel rms by mip ${r.rough.map((v) => v.toFixed(3)).join('/')}  ${r.res}px K${r.K}${r.faithful ? `  layers ${r.layerRes}px @ ${r.heights.map((h) => h.toFixed(2)).join('/')} m` : ''}`;
      record('fill', c.name, bad.length === 0, bad.join('; ') || detail);
      log(`  ${bad.length ? 'FAIL' : 'ok  '}  ${c.name.padEnd(62)} ${bad.join('; ') || detail}`);
    }

    if (!gateOnly && !robustOnly && !fillOnly && !edgeOnly) log('\nLOOK-UP RAY — the lantern\'s shared ray (wood read) against komorebi-fill.js, on the layers and wood the engine baked');
    for (const c of (gateOnly || robustOnly || fillOnly || edgeOnly) ? [] : SKY_CHECKS) {
      let r;
      try { r = await page.evaluate(([p, o]) => window.__skyCheck(p, o), [c.preset, c.over]); }
      catch (e) { record('sky', c.name, false, e.message.split('\n')[0]); log(`  FAIL  ${c.name} — ${e.message.split('\n')[0]}`); continue; }
      const bad = [];
      for (const q of ['T', 'Tb', 'L']) if (r.err[q] > SKY_TOL) bad.push(`${q} off by ${r.err[q].toExponential(2)}`);
      if (r.glError) bad.push(`gl.getError 0x${r.glError.toString(16)}`);
      if (!(r.woodTexels > 0)) bad.push('the wood texture is empty: nothing was measured');
      if (!(r.woodHit > 0)) bad.push('no ray met the wood: its read was not measured');
      if (!(r.glowing > 0)) bad.push('no ray met a lit leaf: the glow was not measured');
      if (c.over.leaf_diffuse > 0 && !(r.killed > 0)) bad.push('no leaf put out the disk on any ray: T_src was not measured');
      const detail = `k ${r.k.toFixed(2)}  errT ${r.err.T.toExponential(1)} errTb ${r.err.Tb.toExponential(1)} errL ${r.err.L.toExponential(1)}  ${r.N} rays @ ${r.n}px: disk killed on ${r.killed}, lit leaf on ${r.glowing}, wood in the way of ${r.woodHit} (of the glow on ${r.woodGlow})  wood ${r.woodTexels} texels, coverage ${r.covTexels}`;
      record('sky', c.name, bad.length === 0, bad.join('; ') || detail);
      log(`  ${bad.length ? 'FAIL' : 'ok  '}  ${c.name.padEnd(32)} ${bad.join('; ') || detail}`);
    }

    if (!gateOnly && !robustOnly && !fillOnly && !skyOnly) log('\nSOFT EDGES — a texel is a mixture, not a slab: the lantern\'s rim, the beam\'s halo, the faithful stamp (§4.5)');
    for (const c of (gateOnly || robustOnly || fillOnly || skyOnly) ? [] : RIM_CHECKS) {
      const name = `rim: ${c.name}`;
      let r;
      try { r = await page.evaluate(([p, o]) => window.__rimCheck(p, o), [c.preset, c.over]); }
      catch (e) { record('edge', name, false, e.message.split('\n')[0]); log(`  FAIL  ${name} — ${e.message.split('\n')[0]}`); continue; }
      const bad = [], peak = Math.max(...r.rimMax), f2 = (a) => a.map((v) => v.toFixed(2)).join('/');
      if (!(peak <= RIM_MAX)) bad.push(`the rim is x${peak.toFixed(2)} of the interior (R/G/B ${f2(r.rimMax)}, at coverage ${f2(r.rimAt)}), over x${RIM_MAX}`);
      if (!(r.nIn >= RIM_MIN_TEXELS && r.nRim >= RIM_MIN_TEXELS)) bad.push(`nothing measured: ${r.nIn} interior and ${r.nRim} rim texels (need ${RIM_MIN_TEXELS})`);
      if (!(r.interiorGlow > 0.01)) bad.push(`the interior does not glow (${r.interiorGlow.toExponential(1)}): nothing to compare the rim with`);
      if (r.glError) bad.push(`gl.getError 0x${r.glError.toString(16)}`);
      const bins = Object.entries(r.byC).sort((a, b) => a[0] - b[0]).map(([b, v]) => `${b}:${v.mean.map((x) => x.toFixed(2)).join('/')}`).join(' ');
      const detail = `k ${r.k.toFixed(2)}  rim peak x${peak.toFixed(2)} (R/G/B ${f2(r.rimMax)})  ${r.nIn} interior / ${r.nRim} rim texels @ ${r.crop}² of ${r.n}px  mean rim/interior by coverage ${bins}`;
      record('edge', name, bad.length === 0, bad.join('; ') || detail);
      log(`  ${bad.length ? 'FAIL' : 'ok  '}  ${name.padEnd(48)} ${bad.join('; ') || detail}`);
    }
    for (const c of (gateOnly || robustOnly || fillOnly || skyOnly) ? [] : HALO_CHECKS) {
      const name = `halo: ${c.name}`;
      let r;
      try { r = await page.evaluate(([p, o]) => window.__haloCheck(p, o), [c.preset, c.over]); }
      catch (e) { record('edge', name, false, e.message.split('\n')[0]); log(`  FAIL  ${name} — ${e.message.split('\n')[0]}`); continue; }
      const bad = [];
      if (r.errTap > HALO_TOL) bad.push(`tap off the mixture by ${r.errTap.toExponential(2)}`);
      if (r.errCA > HALO_TOL) bad.push(`tapCA off the mixture by ${r.errCA.toExponential(2)}`);
      if (!(r.shaderOverMix >= HALO_BAND[0] && r.shaderOverMix <= HALO_BAND[1])) bad.push(`the soft-edge band's mean beam is x${r.shaderOverMix.toFixed(3)} of the mixture's (want ${HALO_BAND.join('..')}; the old slab read x${r.slabOverMix.toFixed(2)}): a dark halo`);
      if (!(r.nBand >= HALO_MIN_TEXELS)) bad.push(`nothing measured: ${r.nBand} soft-edge texels (need ${HALO_MIN_TEXELS})`);
      if (!(r.slabOverMix < 0.95)) bad.push(`the slab is not darker than the mixture here (x${r.slabOverMix.toFixed(2)}): this look cannot show a halo`);
      if (r.glError) bad.push(`gl.getError 0x${r.glError.toString(16)}`);
      const detail = `k ${r.k.toFixed(2)}  errTap ${r.errTap.toExponential(1)} errTapCA ${r.errCA.toExponential(1)}  soft-edge band ${r.nBand} texels: shader ${(r.bandShader / r.nBand).toFixed(3)} mixture ${(r.bandMix / r.nBand).toFixed(3)} (x${r.shaderOverMix.toFixed(3)}), the slab ${(r.bandSlab / r.nBand).toFixed(3)} (x${r.slabOverMix.toFixed(2)}), worst texel x${r.worstRatio.toFixed(2)}  ${r.crop}² of ${r.n}px, ${r.byLayer.length} layers`;
      record('edge', name, bad.length === 0, bad.join('; ') || detail);
      log(`  ${bad.length ? 'FAIL' : 'ok  '}  ${name.padEnd(48)} ${bad.join('; ') || detail}`);
    }
    for (const c of (gateOnly || robustOnly || fillOnly || skyOnly) ? [] : [{ name: 'FS_FAITH, one leaf at leaf_diffuse 0.95 (the faithful floor and cloth)', opts: { d: 0.95 } }]) {
      const name = `stamp: ${c.name}`;
      let r;
      try { r = await page.evaluate((o) => window.__stampCheck(o), c.opts); }
      catch (e) { record('edge', name, false, e.message.split('\n')[0]); log(`  FAIL  ${name} — ${e.message.split('\n')[0]}`); continue; }
      const bad = [], f3 = (a) => a.map((v) => v.toFixed(3)).join('/');
      for (const row of r.rows) {
        if (row.err > STAMP_TOL) bad.push(`${row.name}: off the per-leaf mixture by ${row.err.toExponential(2)}`);
        if (!row.finite) bad.push(`${row.name}: a non-finite pixel`);
        if (row.glError) bad.push(`${row.name}: gl.getError 0x${row.glError.toString(16)}`);
        if (row.name === 'fade 1') {
          if (!(row.nBand >= 100)) bad.push(`${row.name}: nothing measured (${row.nBand} edge-band pixels)`);
          if (!row.bandOverMix.every((v) => v >= 0.999)) bad.push(`${row.name}: the edge band's mean is x${f3(row.bandOverMix)} of the mixture's (the slab's x${f3(row.slabOverMix)})`);
        }
      }
      const detail = `k ${r.k.toFixed(2)}  ${r.rows.map((x) => `${x.name} err ${x.err.toExponential(1)}`).join(', ')}  edge band x${f3(r.rows[0].bandOverMix)} of the mixture (the slab: x${f3(r.rows[0].slabOverMix)}), ${r.rows[0].nBand} px`;
      record('edge', name, bad.length === 0, bad.join('; ') || detail);
      log(`  ${bad.length ? 'FAIL' : 'ok  '}  ${name.padEnd(72)} ${bad.join('; ') || detail}`);
    }

    if (!gateOnly && !robustOnly && !skyOnly && !edgeOnly) log('\nSKY FILL — the bookkeeping: what the engine\'s fill holds against what the leaves emitted and the beam gave up');
    for (const c of (gateOnly || robustOnly || skyOnly || edgeOnly) ? [] : FILL_ENERGY) {
      let r;
      try { r = await page.evaluate(([p, o, q]) => window.__fillCheck(p, o, q), [c.preset, c.over, { rebake: !!c.rebake, energy: true, samples: 8 }]); }
      catch (e) { record('fill', c.name, false, e.message.split('\n')[0]); log(`  FAIL  ${c.name} — ${e.message.split('\n')[0]}`); continue; }
      const en = r.energy, bad = [], f3 = (a) => a.map((v) => v.toFixed(3)).join(' '), ratio = (a, b) => a.map((v, i) => (b[i] > 1e-9 ? v / b[i] : NaN));
      const vsE = ratio(en.Reng, en.Etot), vsR = ratio(en.Reng, en.Ropen), vsIn = ratio(en.Reng, en.Rin), vsD = ratio(en.Reng, en.Dbeam), inShare = ratio(en.Rin, en.Ropen);
      const lit = en.Etot.map((e) => e >= 0.1 * Math.max(...en.Etot));   // a channel carrying under a tenth of the light (afternoon 7's blue) is all noise floor: reported, not judged
      const within = (v, tol, what) => v.forEach((x, ch) => { if (lit[ch] && !(Math.abs(x - 1) <= tol)) bad.push(`channel ${ch}: ${what} ${Number.isFinite(x) ? x.toFixed(4) : x} is not 1 ± ${tol}`); });
      if (!(en.Etot[1] > 0)) bad.push('nothing was emitted: nothing was measured');
      if (c.kind === 'bottom') within(vsE, ENERGY_BOTTOM, 'Reng/E_L0');
      if (c.kind === 'park') {
        within(vsR, ENERGY_CLOSE, 'Reng/R');
        vsD.forEach((x, ch) => { if (lit[ch] && !(x >= ENERGY_BEAM[0] && x <= ENERGY_BEAM[1])) bad.push(`channel ${ch}: Reng/D_beam ${Number.isFinite(x) ? x.toFixed(3) : x} is outside ${ENERGY_BEAM[0]}..${ENERGY_BEAM[1]}`); });
      }
      if (c.kind === 'tree') {
        inShare.forEach((x, ch) => { if (lit[ch] && !(x >= ENERGY_IN_FRAME)) bad.push(`channel ${ch}: the frame holds ${Number.isFinite(x) ? x.toFixed(3) : x} of what the leaves send down (< ${ENERGY_IN_FRAME})`); });
        within(vsIn, ENERGY_TREE_NOISE, 'Reng/R_in');
        if (!(en.edge <= ENERGY_DECAY * en.crown)) bad.push(`S at the frame's edge ${en.edge.toFixed(4)} is above ${ENERGY_DECAY}× the crown's ${en.crown.toFixed(4)}`);
      }
      const detail = `E/layer ${en.E.map((e) => e[1].toFixed(2)).join(' ')}  E ${f3(en.Etot)}  R_open ${f3(en.Ropen)}  D_beam ${f3(en.Dbeam)}  Reng ${f3(en.Reng)}  Reng/E ${f3(vsE)}  Reng/R ${f3(vsR)}${c.kind === 'tree' ? `  in-frame share ${f3(inShare)}  Reng/R_in ${f3(vsIn)}` : `  Reng/D ${f3(vsD)}`}  edge/crown ${(en.edge / en.crown).toFixed(3)}  frame ${en.frame.ext.toFixed(1)} m ${en.mode}  gS ${en.gS.map((v) => v.toFixed(2))}`;
      record('fill', c.name, bad.length === 0, bad.join('; ') || detail);
      log(`  ${bad.length ? 'FAIL' : 'ok  '}  ${c.name.padEnd(86)} ${bad.join('; ') || detail}`);
      if (bad.length) log(`        ${detail}`);
    }

    if (!gateOnly && !robustOnly && !skyOnly && !edgeOnly) log('\nSKY FILL — canopy_fill opened and shut on a running engine');
    for (const c of (gateOnly || robustOnly || skyOnly || edgeOnly) ? [] : FILL_TOGGLES) {
      const name = `${c.name}: ${c.sky ? 'opening it allocates nothing and moves nothing' : 'shut costs nothing, open bakes, shut again is the old frame'}`;
      let r;
      try { r = await page.evaluate(([p, o, q]) => window.__fillToggle(p, o, q), [c.preset, c.over, { rebake: !!c.rebake }]); }
      catch (e) { record('fill', name, false, e.message.split('\n')[0]); log(`  FAIL  ${name} — ${e.message.split('\n')[0]}`); continue; }
      const [shut, open, again] = r.stages, bad = [];
      if (shut.allocated || shut.ready) bad.push('the shut gate allocated or baked a fill');
      if (c.sky) {
        if (open.allocated || open.ready) bad.push('the sky view allocated a fill');
        if (!r.diff.openVsShut0.equal) bad.push('the sky frame moved when canopy_fill opened');
      } else {
        if (!open.allocated || !open.ready) bad.push('opening canopy_fill did not bake a fill');
        if (r.diff.openVsShut0.equal) bad.push('the open frame equals the shut one');
      }
      if (again.allocated || again.ready) bad.push('shutting canopy_fill did not free the fill');
      if (!r.diff.shutAgain.equal) bad.push(`shut again is not the old frame (${r.diff.shutAgain.diffPixels}/${r.diff.shutAgain.total} px differ)`);
      if (r.glError) bad.push(`gl.getError 0x${r.glError.toString(16)}`);
      const detail = `${shut.hash} -> ${open.hash} -> ${again.hash}   allocated ${[shut, open, again].map((x) => (x.allocated ? 'yes' : 'no')).join('/')}`;
      record('fill', name, bad.length === 0, bad.join('; ') || detail);
      log(`  ${bad.length ? 'FAIL' : 'ok  '}  ${name.padEnd(100)} ${bad.join('; ') || detail}`);
    }

    // (the carpet's own live rows run with `--gate litter` too: a gate row alone cannot see a signature that forgot a number)
    const litterRowsToo = gateOnly && (!gateFilters.length || gateFilters.some((f) => f && 'litter'.includes(f)));
    const liveRows = (gateOnly || robustOnly || skyOnly || edgeOnly) ? (litterRowsToo ? LIVE_CHANGES.filter((c) => c.litter) : []) : LIVE_CHANGES;
    if (liveRows.length) log('\nLIVE KNOBS — changed on a running engine, nothing rebuilt (leaf_diffuse tweens; the carpet is noticed at draw time)');
    for (const c of liveRows) {
      const name = `${c.key} live: ${c.name}`;
      let a, b;
      try {
        const opts = c.rebake ? { rebake: true } : undefined;
        a = await page.evaluate(([p, o, f, q]) => window.__run(p, o, [f], q), [c.preset, { ...c.over, [c.key]: c.value }, 36, opts]);   // born with the knob
        b = await page.evaluate(([p, o, k, v, q]) => window.__liveChange(p, o, k, v, q), [c.preset, c.over, c.key, c.value, { rebake: !!c.rebake, apply: c.apply || null }]);   // the knob moved at tick 15
      } catch (e) { record('live', name, false, e.message.split('\n')[0]); log(`  FAIL  ${name} — ${e.message.split('\n')[0]}`); continue; }
      const d = await page.evaluate(([x, y]) => window.__diff(x, y), [a.captures[0].id, b.capture.id]);
      const never = await page.evaluate(([p, o, q]) => window.__run(p, o, [36], q), [c.preset, c.over, c.rebake ? { rebake: true } : undefined]);   // ...and the frame it must NOT be: the knob never moved
      const stale = await page.evaluate(([x, y]) => window.__diff(x, y), [never.captures[0].id, b.capture.id]);
      const bad = [];
      if (!d.equal) bad.push(`${d.diffPixels}/${d.total} px differ from a frame born with it (max Δ${d.maxDelta})`);
      if (stale.equal) bad.push('the frame is the one from before the change — the knob did nothing');
      if (a.glError || b.glError) bad.push(`gl.getError 0x${(a.glError || b.glError).toString(16)}`);
      record('live', name, bad.length === 0, bad.join('; ') || `identical to a frame born with it (${a.captures[0].hash}); the unchanged frame is ${never.captures[0].hash}`);
      log(`  ${bad.length ? 'FAIL' : 'ok  '}  ${name.padEnd(100)} ${bad.join('; ') || a.captures[0].hash}`);
    }

    // ---- suite 2c: the litter carpet (§4.7). Runs with the full sweep, and alone as `--gate litter`. ----
    const litterRun = !solo || (gateOnly && (!gateFilters.length || gateFilters.some((f) => f && 'litter'.includes(f))));
    if (litterRun) log('\nLITTER — the carpet the engine baked, read back and held to the grove\'s own list');
    for (const c of litterRun ? LITTER_CHECKS : []) {
      const name = `carpet: ${c.name}`;
      let r;
      try { r = await page.evaluate(([p, o]) => window.__litterCheck(p, o), [c.preset, c.over]); }
      catch (e) { record('litter', name, false, e.message.split('\n')[0]); log(`  FAIL  ${name} — ${e.message.split('\n')[0]}`); continue; }
      const bad = [], f3 = (a) => a.map((v) => v.toFixed(3)).join('/');
      if (!r.ready) bad.push('the carpet is not ready');
      if (r.passes !== 1) bad.push(`${r.passes} bake passes in 24 frames: it is baked once per regrow, not per frame`);
      if (r.res !== (c.over.litter_resolution ?? 1024)) bad.push(`texture is ${r.res} px, not litter_resolution`);
      if (r.frameErr > 1e-4) bad.push(`frame is off fillFrame(E, h_max, bulkOn) by ${r.frameErr.toExponential(2)} m`);
      if (r.fillFrameErr != null && r.fillFrameErr > 1e-4) bad.push(`frame is off the fill's own by ${r.fillFrameErr.toExponential(2)} m`);
      if (r.count !== r.instCpu) bad.push(`the bake drew ${r.count} stamps, the pure function made ${r.instCpu}`);
      const ra = r.raster;
      if (ra.meanAlpha > LITTER_RASTER.alpha) bad.push(`the carpet's coverage is off the CPU painting of its stamps by ${ra.meanAlpha.toFixed(4)} per covered texel (max ${ra.maxAlpha.toFixed(3)})`);
      if (ra.meanRgb > LITTER_RASTER.rgb) bad.push(`the carpet's colour is off the CPU painting by ${ra.meanRgb.toFixed(4)} per covered texel`);
      if (!(r.area.ratioCpu >= LITTER_RASTER.area[0] && r.area.ratioCpu <= LITTER_RASTER.area[1])) bad.push(`covered area is x${r.area.ratioCpu.toFixed(3)} of the CPU painting's`);
      // the layering is a matter of COLOUR (coverage is the same whichever leaf is on top), so the yardstick is the colour: the GPU's distance from the right painting, against the
      // wrong painting's distance from it
      if (!c.sparse && !(ra.meanRgb <= LITTER_RASTER.vsOrder * ra.orderRgb)) bad.push(`the GPU's colour agrees with the CPU painting by ${ra.meanRgb.toFixed(4)}, but painting the other way round differs by only ${ra.orderRgb.toFixed(4)}: the layering is not measured`);
      if (!c.sparse && !(ra.orderRgb > 0.02)) bad.push('the first-on-top and last-on-top paintings are the same carpet: the layering is not measured');
      if (!(r.area.got <= r.area.leaves * LITTER_OVER)) bad.push(`the carpet covers ${r.area.got.toFixed(2)} m², more than the ${r.area.leaves.toFixed(2)} m² of leaves lying on it (+${Math.round((LITTER_OVER - 1) * 100)}% for the rim)`);
      if (c.sparse) {
        if (!(r.area.ratioLeaves >= LITTER_SPARSE.area[0] && r.area.ratioLeaves <= LITTER_SPARSE.area[1])) bad.push(`a sparse carpet covers x${r.area.ratioLeaves.toFixed(3)} of Σπ·A·B0·fade (want ${LITTER_SPARSE.area.join('..')})`);
        r.mean.forEach((m, ch) => { if (r.meanCpu[ch] > 0.03 && !(Math.abs(m / r.meanCpu[ch] - 1) <= LITTER_SPARSE.mean)) bad.push(`mean albedo channel ${ch}: ${m.toFixed(4)} against ${r.meanCpu[ch].toFixed(4)}`); });
        if (!(r.area.leaves > 1)) bad.push(`only ${r.area.leaves.toFixed(2)} m² of leaves: nothing was measured`);
      }
      if (c.drift) {
        const want = Math.hypot(...r.driftWant), got = Math.hypot(...r.driftGot);
        const angle = Math.abs(((Math.atan2(r.driftGot[1], r.driftGot[0]) - Math.atan2(r.driftWant[1], r.driftWant[0]) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 180 / Math.PI;
        if (!(want > 0.2)) bad.push(`the drift is ${want.toFixed(3)} m: nothing was measured`);
        if (!(angle <= LITTER_DRIFT.angleDeg)) bad.push(`the carpet is carried ${angle.toFixed(1)}° off the wind (${f3(r.driftGot)} against ${f3(r.driftWant)} m)`);
        if (!(Math.abs(got / want - 1) <= LITTER_DRIFT.len)) bad.push(`the carpet is carried ${got.toFixed(3)} m, the leaves' own drift is ${want.toFixed(3)} m`);
      }
      if (r.glError) bad.push(`gl.getError 0x${r.glError.toString(16)}`);
      const detail = `${r.res}px over ${r.frame.ext.toFixed(1)} m (${r.texelCm.toFixed(1)} cm/texel)  ${r.nLeaves} leaves, ${r.count} stamps, ${(100 * ra.covered).toFixed(0)}% covered  vs CPU painting: α ${ra.meanAlpha.toFixed(4)} rgb ${ra.meanRgb.toFixed(4)} (the other order: α ${ra.orderAlpha.toFixed(3)} rgb ${ra.orderRgb.toFixed(3)})  area ${r.area.got.toFixed(2)} of ${r.area.leaves.toFixed(2)} m² of leaves${c.drift ? `  drift (${f3(r.driftGot)}) vs (${f3(r.driftWant)}) m` : ''}  passes ${r.passes}`;
      record('litter', name, bad.length === 0, bad.join('; ') || detail);
      log(`  ${bad.length ? 'FAIL' : 'ok  '}  ${name.padEnd(100)} ${bad.join('; ') || detail}`);
      if (bad.length) log(`        ${detail}`);
    }
    if (litterRun) {
      const name = 'stamp: layering, the blend, sub-texel energy and the rim (VS_LITTER/FS_LITTER as compiled)';
      let r;
      try { r = await page.evaluate(() => window.__litterStamp()); }
      catch (e) { record('litter', name, false, e.message.split('\n')[0]); log(`  FAIL  ${name} — ${e.message.split('\n')[0]}`); r = null; }
      if (r) {
        const bad = [], near = (got, want, what) => got.forEach((v, i) => { if (!(Math.abs(v - want[i]) <= LITTER_STAMP_TOL)) bad.push(`${what}: ${got.map((x) => x.toFixed(3)).join('/')} is not ${want.map((x) => x.toFixed(3)).join('/')}`); });
        // green at fade 0.5 over red: premultiplied over, src + dst·(1 − a): the colour is the mixture and the alpha is 1 − (1 − 0.5)(1 − 1) = 1
        near(r.overlap, [0.5, 0.45, 0.075, 1], 'a half-faded green laid OVER red');
        near(r.reversed, [0.9, 0.1, 0.05, 1], 'the same two, red laid last: the red wins outright (instance order is the layering)');
        near(r.onlyRed, [0.9, 0.1, 0.05, 1], 'red alone');
        near(r.onlyGreen, [0.05, 0.4, 0.05, 0.5], 'green alone is premultiplied (rgb·a, a)');
        if (!(r.tinyArea / r.tinyWant >= 0.9 && r.tinyArea / r.tinyWant <= 1.35)) bad.push(`sixteen sub-texel leaves keep x${(r.tinyArea / r.tinyWant).toFixed(3)} of their area (each is enlarged and its alpha spent: the rim's ramp may add up to ~25%, never take it away)`);
        if (!(r.tinyMax > 0 && r.tinyMax < 0.2)) bad.push(`a sub-texel leaf's peak alpha ${r.tinyMax.toFixed(3)}: not enlarged, or not dimmed`);
        if (!(Math.abs(r.discArea / r.discWant - 1) <= 0.02)) bad.push(`a disc of radius 10 covers x${(r.discArea / r.discWant).toFixed(4)} of π·10²`);
        near(r.centre.slice(0, 3), [0.5, 0.5, 0.5], 'the disc interior'); if (r.centre[3] < 0.99) bad.push(`the disc's interior alpha is ${r.centre[3].toFixed(3)}`);
        if (!(r.rim > 20 && r.rim < 140)) bad.push(`the rim is ${r.rim} texels wide in total: one texel of anti-aliasing is ~${Math.round(2 * Math.PI * 10)}`);
        if (r.glError) bad.push(`gl.getError 0x${r.glError.toString(16)}`);
        const detail = `overlap ${r.overlap.map((v) => v.toFixed(3)).join('/')}  reversed ${r.reversed.map((v) => v.toFixed(2)).join('/')}  sub-texel area (16 phases) x${(r.tinyArea / r.tinyWant).toFixed(3)} (peak α ${r.tinyMax.toFixed(3)})  disc x${(r.discArea / r.discWant).toFixed(4)}, rim ${r.rim} texels`;
        record('litter', name, bad.length === 0, bad.join('; ') || detail);
        log(`  ${bad.length ? 'FAIL' : 'ok  '}  ${name.padEnd(100)} ${bad.join('; ') || detail}`);
      }
    }

    // ---- suite 4: transition routing ----
    if (!solo) log('\nTRANSITIONS — each routing tier driven to completion (logic-only; no pixels)');
    for (const route of solo ? [] : TRANSITION_ROUTES) {
      let r;
      try {
        r = await page.evaluate(([from, to, over, opts]) => window.__transitionSmoke(from, to, over, opts), [route.from, route.to, route.over, route.interrupt ? { interrupt: route.interrupt } : {}]);
      } catch (e) {
        record('transition', route.name, false, e.message.split('\n')[0]);
        log(`  FAIL  ${route.name} — ${e.message.split('\n')[0]}`);
        continue;
      }
      const bad = [];
      if (route.interrupt) {                     // an aborted route must not pretend it completed
        if (!r.interrupted) bad.push('interrupt never fired');
        if (r.onEndFired) bad.push('onEnd fired despite the abort');
      } else if (!r.onEndFired) bad.push('onEnd never fired');
      if (r.glError) bad.push(`gl.getError 0x${r.glError.toString(16)}`);
      for (const [k, v] of Object.entries(route.expect)) if (r[k] !== v) bad.push(`${k}=${r[k]} (want ${v})`);
      record('transition', route.name, bad.length === 0, bad.length ? bad.join('; ')
        : `crossfade ${r.crossfade} structDiff ${r.structDiff}  ${r.ticks} ticks ${r.ms} ms`);
      log(`  ${bad.length ? 'FAIL' : 'ok  '}  ${route.name.padEnd(50)} ${bad.join('; ') || `${r.ticks} ticks ${r.ms} ms`}`);
    }
    }
    if (!filters.length && !gateOnly && !fillOnly && !skyOnly && !edgeOnly) await robustness(page);
  } finally {
    await browser.close();
    server.close();
  }

  // ---- the table ----
  const w0 = Math.max(...results.map((r) => r.name.length), 4);
  log(`\n${'─'.repeat(w0 + 60)}`);
  log(`${'SUITE'.padEnd(13)}${'CASE'.padEnd(w0 + 2)}RESULT  DETAIL`);
  log('─'.repeat(w0 + 60));
  for (const r of results) {
    if (!r.pass) failures++;
    log(`${r.suite.padEnd(13)}${r.name.padEnd(w0 + 2)}${(r.pass ? 'pass' : 'FAIL').padEnd(8)}${r.detail}`);
  }
  log('─'.repeat(w0 + 60));
  log(`${results.length} cases, ${results.length - failures} pass, ${failures} fail   ·   screenshots in test-gl/out/`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
