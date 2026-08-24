// ============================================================================
// Komorebi — shared WebGL2 engine, an ES module:  import { create } from "./komorebi.js".
// This file is the public door; the engine lives in the modules behind it.
// komorebi-engine.js is create() itself — GL plumbing, the shared-internals hub,
// the rebuild coordinators, auto-quality and the frame loop — and each subsystem
// is a factory module over that hub:
//   komorebi-grove.js         buildGrove — the grown canopy (spec §4.5)
//   komorebi-bake.js          the layer + faithful bakes (spec §4.5)
//   komorebi-source.js        the point-sun cloud + shared cast geometry (spec §4.4)
//   komorebi-motion.js        wind + the spring hierarchy (spec §5)
//   komorebi-transitions.js   the cloud-bloom crossfade between looks (spec §9)
//   komorebi-render.js        the frame draw + uniform upload + glow tier (spec §4.6/§4.7)
//   komorebi-editor-tools.js  debug overlays, profiler, motion mirror (EDITOR only)
// with the shared foundations imported by all of them:
//   komorebi-transport.js     the transport master + camera registry (spec §4.6/§4.9)
//   komorebi-shaders.js       the bake / faithful / display shaders + the tone tail
//   komorebi-params.js        DEFAULTS, legacy migration, transition keys, engine caps
//   komorebi-math.js          CPU math: atmosphere, RNG, wind noise, growth helpers
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

// The export surface, and why each group is on it. `create` + `DEFAULTS` are the engine; LEGACY_KEYS/migrateLegacy
// are the params contract (§9); the MAX_* caps and DEG are shared constants consumers size buffers against.
// MORPH/CANOPY/TOPO/MODE_KEYS and CAMERAS/TRANSPORT_GROUPS/GROUP_UPLOAD_KEYS are exported for the SAME reason and
// only that reason: they are couplings that would otherwise fail silently, so a `bun test` reads them and fails
// loudly instead (transitions.test.js classifies every knob, registry.test.js keeps the camera registry's three
// halves in agreement). TRANSPORT_CAMERAS/buildTransport are glslcheck's door onto the assembled variants.
// cameraFor is the registry's selector: the editor asks it which camera a look runs so it can hide the knobs that
// camera's groups never read (§4.9), rather than keeping a second copy of the receiver/sky_view chain.
export { create } from './komorebi-engine.js';
export { DEFAULTS, LEGACY_KEYS, migrateLegacy, MAX_LAYERS, MAX_SAMPLES, MAX_OCC, MORPH_KEYS, CANOPY_KEYS, TOPO_KEYS, MODE_KEYS } from './komorebi-params.js';
export { DEG } from './komorebi-math.js';
export { TRANSPORT_CAMERAS, TRANSPORT_GROUPS, CAMERAS, GROUP_UPLOAD_KEYS, cameraFor, buildTransport } from './komorebi-transport.js';
