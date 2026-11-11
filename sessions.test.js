import { expect, test } from 'bun:test';
import * as sessions from './komorebi-session.js';
import { DEFAULTS } from './komorebi-params.js';
import { makeTransitions } from './komorebi-transitions.js';
import { keptFeatures } from './embed-build.mjs';
import { PRESETS } from './presets.js';

test('session FPS policy survives old look loads, transitions and a preference reload', () => {
  const saved = JSON.parse(JSON.stringify({ version: 1, playback: { adaptive_motion: false } }));
  const session = sessions.resolveSession(saved);
  const a = sessions.resolveParams({ ...DEFAULTS, adaptive_motion: true }, session);
  expect(a.adaptive_motion).toBe(false);
  const hub = { params: a, trans: {}, layerVAO: [], faithfulOn: () => false, motionActive: () => false,
    warnCut() {}, regenSource() {}, resetPerf() {}, bake() {}, regenCanopy() {} };
  const t = makeTransitions(hub);
  t.transitionTo(sessions.resolveParams({ ...DEFAULTS, exposure: 2, adaptive_motion: true }, session), { duration: 0.1 });
  for (let i = 0; i < 50 && hub.trans.active; i++) t.tickTransition(1 / 60)?.();
  expect(hub.params.adaptive_motion).toBe(false);
  expect(sessions.resolveParams({ adaptive_motion: true }, sessions.resolveSession(saved)).adaptive_motion).toBe(false);
});

test('six fidelity ceilings preserve omission and authored requests; layers remain art', () => {
  const session = sessions.resolveSession({ quality: 'balanced' });
  expect(session.ceilings).toBeDefined();
  const cap = session.ceilings.sample_count;
  expect(sessions.resolveParams({}, session).sample_count).toBe(cap);
  expect(sessions.resolveParams({ sample_count: cap - 1 }, session).sample_count).toBe(cap - 1);
  const look = { sample_count: cap + 10, layer_count: 4, bake_resolution: 0, tex_resolution: 1024 };
  expect(sessions.resolveParams(look, session).sample_count).toBe(cap);
  expect(sessions.resolveParams(look, session).layer_count).toBe(4);
  expect(sessions.resolveParams(look, session).bake_resolution).toBe(Math.min(1024, session.ceilings.bake_resolution));
  expect(sessions.authoredLook(look)).toEqual(look);
  expect(sessions.authoredLook({ exposure: 1, adaptive_motion: false })).toEqual({ exposure: 1 });
});

test('presentation follows the playlist unless explicitly overridden, independent of FPS', () => {
  expect(sessions.resolveSession({}, { presentation: 'projector' }).presentation).toBe('projector');
  const s = sessions.resolveSession({ presentation: 'screen', playback: { adaptive_motion: false } }, { presentation: 'projector' });
  expect(sessions.resolveParams({ edge_area: false }, s).edge_area).toBe(true);
  expect(sessions.resolveParams({}, s).adaptive_motion).toBe(false);
  expect(() => sessions.resolveSession({ presentation: 'unknown' })).toThrow('presentation');
  expect(() => sessions.resolveSession({ quality: 'unknown' })).toThrow('quality');
});

test('automatic bundles retain the edge law a screen session opens', () => {
  expect(keptFeatures(['morning 2'])).toContain('leafDiffuse');
});

test('ordinary built-ins inherit fidelity while preserving authored layer structure',()=>{
  expect(PRESETS['afternoon 5']).not.toHaveProperty('sample_count');
  expect(PRESETS['afternoon 5']).not.toHaveProperty('tex_resolution');
  expect(PRESETS['afternoon 5'].layer_count).toBe(3);
  expect(Object.values(PRESETS).some(look=>look.sky_view && look.bake_resolution===1536)).toBe(true);
});

test('automatic FPS measures a whole ten-second window, with 45 fps staying full-rate',()=>{
  expect(typeof sessions.makeFpsProbe).toBe('function');
  for(const [fps,low] of [[40,true],[45,false],[60,false]]){
    const probe=sessions.makeFpsProbe();let result=null;
    for(let i=0;i<fps*10;i++)result=probe.observe(1000/fps)??result;
    expect(result.low).toBe(low);expect(result.fps).toBeCloseTo(fps,6);
    expect(probe.observe(1000)).toBeNull();
  }
  const probe=sessions.makeFpsProbe();
  expect(probe.observe(200)).toBeNull();
  let result;
  for(let i=0;i<490;i++)result=probe.observe(20)??result;
  expect(result.low).toBe(false);
});
