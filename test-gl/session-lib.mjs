// The exporter calls the pinned engine's policy, never the harness checkout's policy.
export function exportSession(engine, requested, authored, presentation) {
  if(!engine.resolveSession || !engine.resolveParams)throw new Error('The pinned engine does not support sessions');
  if(!requested || typeof requested!=='object' || Array.isArray(requested))throw new Error('session must be an object');
  for(const key of Object.keys(requested))if(!['quality','presentation','ceilings'].includes(key))throw new Error(`Unknown export session field: ${key}`);
  if(requested.quality==='auto')throw new Error('Export quality must be fixed, not auto');
  const resolved=engine.resolveSession({...requested,quality:requested.quality??'export',playback:{auto_quality:false,adaptive_motion:false}}, {presentation});
  return {requested,authored,resolved,effective:authored.map(look=>engine.resolveParams(look,resolved))};
}
