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
// name matches, if any are given — the fast loop for a gate you are adding) and `--fill` (only the sky fill's
// shader-vs-reference check).
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
  // ...and the sky view, which this phase leaves unsplit, must not so much as notice it.
  { name: 'the sky view ignores leaf_diffuse (1 == 0)', preset: 'canopy 1', a: { leaf_diffuse: 0 }, b: { leaf_diffuse: 1 } },
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
  // 1.22, the tent 0.70 against 1.04, and the curtain — a dim look, where the leaf light is as bright as its whole sky — 1.00 against
  // 2.03. The bounds below sit between the two, so they are floors under a loss, not a fit to a number. (park 1 is not here: its leaves
  // pass so little of the sun that the frame cannot tell; the faithful S is held by the fill check's energy balance instead.)
  { name: 'the diffuse light lands in the shade (layer path)', preset: 'memories', lit: [1.0, 1.6],
    a: { canopy_fill: 1, leaf_diffuse: 0 }, b: { canopy_fill: 1, leaf_diffuse: 0.95 } },
  // the cloth and the tent used to read Tsky alone; with the beam gone dark they have to read S too, or the energy leaks
  { name: 'the diffuse light lands on the cloth (curtain)', preset: 'curtain 1', lit: [1.5, 3],
    a: { canopy_fill: 1, leaf_diffuse: 0 }, b: { canopy_fill: 1, leaf_diffuse: 0.95 } },
  { name: 'the diffuse light lands on the cloth (tent)', preset: 'tent 1', lit: [0.9, 1.3],
    a: { canopy_fill: 1, leaf_diffuse: 0 }, b: { canopy_fill: 1, leaf_diffuse: 0.95 } },
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
// leaf_diffuse (and with it k) changed on a RUNNING engine, nothing rebuilt (it tweens, so a transition and a slider both do this):
// the frame must be the one an engine made with the knob already there shows. The fill's signature carries k so S re-bakes, and on
// the faithful path the cast has k baked in, so a frame that kept the old cast would look like the knob did nothing.
const LIVE_CHANGES = [
  { name: 'memories (layer path: the tap reads it, the fill re-bakes)', preset: 'memories', over: { canopy_fill: 1 }, key: 'leaf_diffuse', value: 0.95 },
  { name: 'park 1 with the fill shut (faithful: the cast is re-cast, nothing else moves)', preset: 'park 1', rebake: true, over: { canopy_fill: 0 }, key: 'leaf_diffuse', value: 0.95 },
  { name: 'park 1 with the fill open (faithful: the cast AND the fill)', preset: 'park 1', rebake: true, over: { canopy_fill: 1 }, key: 'leaf_diffuse', value: 0.95 },
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
    const solo = robustOnly || gateOnly || fillOnly;   // one suite, nothing else
    const gateFilters = gateOnly ? process.argv.slice(3).map((s) => s.toLowerCase()) : [];
    const filters = (gateOnly || fillOnly) ? [] : process.argv.slice(2).filter((a) => a !== '--robust').map((s) => s.toLowerCase());
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
    if (!fillOnly) log(`\nGATE INVARIANTS — byte-identical off-paths @ ${GATE_FRAMES} frames`);
    for (const inv of fillOnly ? [] : INVARIANTS.filter((r) => !gateFilters.length || gateFilters.some((f) => r.name.toLowerCase().includes(f)))) {
      const opts = inv.rebake ? { rebake: true } : undefined;
      const a = await page.evaluate(([p, o, f, q]) => window.__run(p, o, [f], q), [inv.preset, inv.a, GATE_FRAMES, opts]);
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
    if (!gateOnly && !robustOnly) log('\nSKY FILL — the shader against komorebi-fill.js, on the layers the engine baked');
    for (const c of (gateOnly || robustOnly) ? [] : FILL_CHECKS) {
      let r;
      try {
        r = await page.evaluate(([p, o, q]) => window.__fillCheck(p, o, q), [c.preset, c.over, { rebake: !!c.rebake }]);
      } catch (e) { record('fill', c.name, false, e.message.split('\n')[0]); log(`  FAIL  ${c.name} — ${e.message.split('\n')[0]}`); continue; }
      const bad = [];
      if (r.errT > FILL_TOL) bad.push(`Tsky off by ${r.errT.toExponential(2)}`);
      if (r.errS > FILL_TOL) bad.push(`S off by ${r.errS.toExponential(2)}`);
      if (!(r.maxT > r.minT + 1e-3)) bad.push(`Tsky is flat (${r.minT.toFixed(4)}..${r.maxT.toFixed(4)}): nothing was measured`);
      if (c.over.leaf_diffuse > 0 && !(r.meanS > 0.01)) bad.push(`S is empty (mean ${r.meanS.toFixed(4)}) with the split on: nothing was measured`);
      const detail = `${r.beamK > 0 ? `k ${r.beamK.toFixed(2)}  ` : ''}errT ${r.errT.toExponential(1)} errS ${r.errS.toExponential(1)}  Tsky ${r.minT.toFixed(2)}..${r.maxT.toFixed(2)} mean ${r.meanT.toFixed(3)}  S mean ${r.meanS.toFixed(3)}  texel-to-texel rms by mip ${r.rough.map((v) => v.toFixed(3)).join('/')}  ${r.res}px K${r.K}${r.faithful ? `  layers ${r.layerRes}px @ ${r.heights.map((h) => h.toFixed(2)).join('/')} m` : ''}`;
      record('fill', c.name, bad.length === 0, bad.join('; ') || detail);
      log(`  ${bad.length ? 'FAIL' : 'ok  '}  ${c.name.padEnd(62)} ${bad.join('; ') || detail}`);
    }

    if (!gateOnly && !robustOnly) log('\nSKY FILL — canopy_fill opened and shut on a running engine');
    for (const c of (gateOnly || robustOnly) ? [] : FILL_TOGGLES) {
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

    if (!gateOnly && !robustOnly) log('\nLEAF DIFFUSE — changed on a running engine, nothing rebuilt');
    for (const c of (gateOnly || robustOnly) ? [] : LIVE_CHANGES) {
      const name = `leaf_diffuse live: ${c.name}`;
      let a, b;
      try {
        const opts = c.rebake ? { rebake: true } : undefined;
        a = await page.evaluate(([p, o, f, q]) => window.__run(p, o, [f], q), [c.preset, { ...c.over, [c.key]: c.value }, 36, opts]);   // born with the knob
        b = await page.evaluate(([p, o, k, v, q]) => window.__liveChange(p, o, k, v, q), [c.preset, c.over, c.key, c.value, { rebake: !!c.rebake }]);   // the knob moved at tick 15
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
    if (!filters.length && !gateOnly && !fillOnly) await robustness(page);
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
