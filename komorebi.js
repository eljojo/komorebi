// ============================================================================
// Komorebi — shared WebGL2 engine, an ES module:  import { create } from "./komorebi.js".
// This file is the public door; the engine lives in the modules it re-exports:
//   komorebi-engine.js     create() — one self-contained engine instance on a canvas
//   komorebi-transport.js  the transport master + camera registry (spec §4.6/§4.9)
//   komorebi-shaders.js    the bake / faithful / display shaders + the tone tail
//   komorebi-params.js     DEFAULTS, legacy migration, transition keys, engine caps
//   komorebi-math.js       CPU math: atmosphere, RNG, wind noise, growth helpers
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
export { create } from './komorebi-engine.js';
export { DEFAULTS, LEGACY_KEYS, migrateLegacy, MAX_LAYERS, MAX_SAMPLES, MAX_OCC, MORPH_KEYS, CANOPY_KEYS, TOPO_KEYS, MODE_KEYS } from './komorebi-params.js';
export { DEG } from './komorebi-math.js';
export { TRANSPORT_CAMERAS, TRANSPORT_GROUPS, CAMERAS, GROUP_UPLOAD_KEYS, buildTransport } from './komorebi-transport.js';
