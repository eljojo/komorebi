import { expect, test } from 'bun:test';
import * as engine from './komorebi.js';
import { exportSession } from './test-gl/session-lib.mjs';

test('exports freeze one pinned session across all authored endpoints and force governors off',()=>{
  const looks=[{sample_count:48,adaptive_motion:true,layer_count:3},{sample_count:8,layer_count:4}];
  const run=exportSession(engine,{quality:'compact'},looks,'projector');
  expect(run.resolved).toBeDefined();
  expect(run.resolved.presentation).toBe('projector');
  expect(run.effective.map(p=>p.sample_count)).toEqual([24,8]);
  expect(run.effective.map(p=>p.layer_count)).toEqual([3,4]);
  expect(run.effective.every(p=>!p.auto_quality&&!p.adaptive_motion&&!p.edge_area)).toBe(true);
  expect(run.authored).toEqual(looks);
  expect(exportSession(engine,{presentation:'screen'},looks,'projector').effective[0].edge_area).toBe(true);
  expect(()=>exportSession({}, {}, looks)).toThrow('does not support sessions');
});
