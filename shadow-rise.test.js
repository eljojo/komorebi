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

test('look up → purple eye lowers the canopy into its shadow footprints',()=>{
 expect(typeof rise.shadowFallEligible).toBe('function');
 expect(rise.shadowFallEligible(fixture.to,fixture.from)).toBe(true);
 expect(rise.shadowFallEligible(fixture.from,fixture.to)).toBe(false);
 for(const [a,b]of[[{sky_view:false},{}],[{},{standing_scene:true}],[{},{litter:1}],[{},{leaf_diffuse:1}],[{branch_tau:1},{}]])
  expect(rise.shadowFallEligible({...fixture.to,...a},{...fixture.from,...b}),JSON.stringify([a,b])).toBe(false);
});

test('a floor with no leaves to cast declines the descent and releases the prepared scene',()=>{
 let released=0;
 const hub={params:{...fixture.to},trans:{}};
 const source={hub:{params:{...fixture.from},faith:{count:0},grove:{}},dispose:()=>released++};
 const flight=rise.makeLitterRise(hub,()=>source);
 expect(flight.beginLitterRise(fixture.from,true,true)).toBe(false);
 expect(released).toBe(1);
 expect(flight.endLitterRise()).toBeUndefined();
 const cast={hub:{params:{...fixture.from},faith:{count:4},grove:{}},dispose:()=>released++};
 expect(rise.makeLitterRise(hub,()=>cast).beginLitterRise(fixture.from,true,true)).toBe(true);
});
