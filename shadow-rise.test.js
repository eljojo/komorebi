import {test,expect} from 'bun:test';
import * as rise from './komorebi-litter-rise.js';
import fixture from './test-gl/fixtures/purple-look-up.json';

test('the approved purple eye → look up pair lifts its shadow footprints',()=>{
 expect(typeof rise.shadowRiseEligible).toBe('function');
 expect(rise.shadowRiseEligible(fixture.from,fixture.to)).toBe(true);
 expect(rise.shadowRiseEligible(fixture.to,fixture.from)).toBe(false);
});

test('shadow pickup excludes surfaces and material laws the approved journey cannot carry',()=>{
 expect(typeof rise.shadowRiseEligible).toBe('function');
 for(const [a,b]of[
  [{sky_view:true},{}],[{faithful_canopy:false},{}],[{standing_scene:true},{}],
  [{},{sky_view:false}],[{},{faithful_canopy:true}],[{},{standing_scene:false}],
  [{receiver:1},{}],[{},{receiver:1}],[{branch_tau:1},{}],[{},{branch_tau:1}],
  [{litter:1},{}],[{leaf_drop:.1},{}],[{},{litter:1}],[{},{leaf_drop:.1}],
  [{canopy_fill:.1},{}],[{},{canopy_fill:.1}],[{inner_leaves:.1},{}],[{},{inner_leaves:.1}],
  [{leaf_diffuse:1},{}],[{},{leaf_diffuse:.1}],[{},{layer_count:4}],
  [{},{eclipse:true}],[{},{edge_area:true}],[{edge_area:true},{edge_area:true}],[{},{leaf_size_m:0}],
  [{},{leaf_size_m:.3}],[{},{leaves_per_cluster:0}],
  [{},{tree_count:100}],[{},{view_pitch_deg:20}],
 ])expect(rise.shadowRiseEligible({...fixture.from,...a},{...fixture.to,...b}),JSON.stringify([a,b])).toBe(false);
});

test('leaf variety, different seeds, grades and wind patterns remain eligible',()=>{
 expect(typeof rise.shadowRiseEligible).toBe('function');
 expect(rise.shadowRiseEligible({...fixture.from,leaf_variety:.8},{...fixture.to,seed:123,leaf_shape:'maple',tone_map:1,wind_pattern:'squally'})).toBe(true);
});
