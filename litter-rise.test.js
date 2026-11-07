import {test,expect} from 'bun:test';
import fixture from './test-gl/fixtures/fall-look-up.json';
import * as rise from './komorebi-litter-rise.js';
test('the authored fall memories → look up pair takes the litter rise route',()=>{
 expect(typeof rise.litterRiseEligible).toBe('function');
 expect(rise.litterRiseEligible(fixture.from,fixture.to)).toBe(true);
 expect(rise.litterRiseEligible(fixture.to,fixture.from)).toBe(false);
});
test('unsupported scenes, optics and over-budget groves retain the existing routes',()=>{
 expect(typeof rise.litterRiseEligible).toBe('function');
 for(const [a,b]of[
  [{litter:0},{}],[{faithful_canopy:false},{}],[{standing_scene:false},{}],
  [{},{sky_view:false}],[{},{faithful_canopy:true}],[{},{receiver:1}],
  [{},{branch_tau:1}],[{},{leaf_drop:.1}],[{},{leaf_diffuse:.1}],
  [{},{layer_count:4}],[{},{inner_leaves:1}],[{},{exposure:1}],
  [{},{wind_strength:2}],[{},{seed:123}],[{},{tree_count:100}],
  [{view_extent_m:40},{}],[{},{canopy_base_height_m:.1}],
 ])expect(rise.litterRiseEligible({...fixture.from,...a},{...fixture.to,...b})).toBe(false);
});
test('floor landings, delayed early colour and the viewer clearance remain the approved laws',()=>{
 expect(typeof rise.riseLeaf).toBe('function');
 const a=[1,-2,0],b=[-.2,1,3.3],atFrame=n=>(n-60)/480;
 for(const id of[0,.25,.5,.75,1]){
  expect(rise.riseLeaf(a,b,0,id).position).toEqual(a);expect(rise.riseLeaf(a,b,1,id).position).toEqual(b);
  expect(rise.riseLeaf(a,b,.04+.1*id+.02,id).translucent).toBe(0);
  expect(rise.riseLeaf(a,b,atFrame(178),id).translucent).toBeGreaterThanOrEqual(.08);
  let before=0;for(let i=0;i<=600;i++){const p=rise.riseLeaf(a,b,i/600,id);expect(p.floor+p.air).toBeCloseTo(1,12);expect(p.translucent).toBeGreaterThanOrEqual(before);expect(p.translucent-before).toBeLessThan(.025);before=p.translucent;}
 }
 const id=.5,t=.37,eye=rise.riseCamera(fixture.from,fixture.to,t).eye,q=rise.riseLeaf([0,0,0],[0,0,1],t,id),f=q.flight;
 const end=[0,0,eye[2]/q.position[2]],start=[(eye[0]-q.position[0])/(1-f),(eye[1]-q.position[1])/(1-f),0];
 const plan=rise.planRiseBypass(start,end,id,fixture.from,fixture.to);
 for(let i=1;i<600;i++){const t=i/600,p=rise.riseBypass(rise.riseLeaf(start,end,t,id).position,plan,t),eye=rise.riseCamera(fixture.from,fixture.to,t).eye;expect(Math.hypot(...p.map((v,j)=>v-eye[j]))).toBeGreaterThan(.6);}
});
