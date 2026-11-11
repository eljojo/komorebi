// Session policy is independent of storage, UI and the rendering context.
import { DEFAULTS, migrateLegacy } from './komorebi-params.js';

export const FIDELITY_KEYS = Object.freeze(['sample_count', 'tex_resolution', 'bake_resolution', 'fill_directions', 'fill_resolution', 'litter_resolution']);
export const PLAYBACK_KEYS = Object.freeze(['auto_quality', 'adaptive_motion', 'adaptive_idle_fps']);
// Provisional starting ceilings, not a measured guarantee of device performance. The live governor can spend less.
const profile = (sample_count, tex_resolution, bake_resolution, fill_directions, fill_resolution, litter_resolution) =>
  Object.freeze({ sample_count, tex_resolution, bake_resolution, fill_directions, fill_resolution, litter_resolution });
export const QUALITY_PROFILES = Object.freeze({
  compact: profile(24, 1024, 768, 8, 128, 512),
  balanced: profile(32, 1024, 1024, 16, 256, 1024),
  high: profile(48, 4096, 2048, 32, 512, 2048),
  export: profile(48, 4096, 4096, 64, 512, 2048),
});
export const PRESENTATION_PROFILES = Object.freeze({ screen: Object.freeze({ edge_area: true }), projector: Object.freeze({ edge_area: false }) });

export function resolveSession(settings = {}, environment = {}) {
  const phone = environment.phone ?? /iPhone|iPod|Android.*Mobile/i.test(environment.userAgent ?? '');
  const automaticQuality=!settings.quality || settings.quality==='auto';
  const quality = automaticQuality ? phone ? 'compact' : 'balanced' : settings.quality;
  const presentation = settings.presentation && settings.presentation !== 'playlist' ? settings.presentation : environment.presentation ?? 'screen';
  if (!Object.hasOwn(QUALITY_PROFILES, quality)) throw new Error(`Unsupported quality profile: ${quality}`);
  if (!Object.hasOwn(PRESENTATION_PROFILES, presentation)) throw new Error(`Unsupported presentation profile: ${presentation}`);
  const ceilings = { ...QUALITY_PROFILES[quality] };
  for (const key of FIDELITY_KEYS) if (Object.hasOwn(settings.ceilings ?? {}, key)) {
    const value = settings.ceilings[key];
    if (!Number.isFinite(value) || value <= 0 || value > QUALITY_PROFILES.export[key]) throw new Error(`Invalid session ceiling: ${key}`);
    ceilings[key] = value;
  }
  if(Number.isFinite(environment.maxTextureSize)) for(const key of ['tex_resolution','bake_resolution','fill_resolution','litter_resolution']) ceilings[key]=Math.min(ceilings[key],environment.maxTextureSize);
  const playback = { auto_quality: true, adaptive_motion: automaticQuality ? false : phone, adaptive_idle_fps: 30 };
  for (const key of PLAYBACK_KEYS) if (Object.hasOwn(settings.playback ?? {}, key)) {
    const value = settings.playback[key];
    if (key === 'adaptive_idle_fps' ? !Number.isFinite(value) || value < 1 || value > 60 : typeof value !== 'boolean') throw new Error(`Invalid playback setting: ${key}`);
    playback[key] = value;
  }
  return { quality, presentation, ceilings, playback, automaticAdaptive:automaticQuality && !Object.hasOwn(settings.playback ?? {},'adaptive_motion') };
}

// Full-rate callbacks are fresh frames while this probe runs. One hitch is averaged over the whole window.
export function makeFpsProbe(){
  let elapsed=0,frames=0,done=false;
  return {observe(dtms){
    if(done || !Number.isFinite(dtms) || dtms<=0)return null;
    elapsed+=dtms;frames++;
    if(elapsed+1e-6<10000)return null;
    done=true;
    return {fps:frames*1000/elapsed,low:frames*1000+1e-6<45*elapsed};
  }};
}

// Omitted settings deliberately retains the flat-params API used by existing embeds and pinned exports.
export function resolveParams(look, session) {
  const authored=migrateLegacy(look) ?? {};
  const result = { ...DEFAULTS, ...authored };
  if (!session) return result;
  for (const key of FIDELITY_KEYS) {
    const request = Object.hasOwn(authored,key) ? authored[key] : session.ceilings[key];
    if(!Number.isFinite(request) || request<0 || request===0 && key!=='bake_resolution')throw new Error(`Invalid look fidelity request: ${key}`);
    result[key] = Math.min(key === 'bake_resolution' && request === 0 ? result.tex_resolution : request, session.ceilings[key]);
  }
  return Object.assign(result, session.playback, PRESENTATION_PROFILES[session.presentation]);
}

export function authoredLook(look) {
  return Object.fromEntries(Object.entries(migrateLegacy(look) ?? {}).filter(([key]) => !PLAYBACK_KEYS.includes(key)));
}
