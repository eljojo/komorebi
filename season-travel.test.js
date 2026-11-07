import {test,expect} from 'bun:test';
import {PRESETS} from './presets.js';
import * as travel from './komorebi-season-travel.js';
import {cameraPose} from './komorebi-math.js';

test('seasonal leaf journeys are monotone, staggered and settle at their own endpoints',()=>{
  expect(typeof travel.flightProgress).toBe('function');
  for(const identity of [0,.1,.5,.9,1]){
    expect(travel.flightProgress(0,identity)).toBe(0);
    expect(travel.flightProgress(1,identity)).toBe(1);
    let prev=0;
    for(let i=1;i<=600;i++){
      const w=travel.flightProgress(i/600,identity);
      expect(w).toBeGreaterThanOrEqual(prev);expect(w).toBeLessThanOrEqual(1);
      expect(w-prev).toBeLessThan(.006);prev=w;
    }
  }
  expect(travel.flightProgress(.35,.1)).not.toBe(travel.flightProgress(.35,.9));
});

test('the standing camera travels through eye space and takes the short yaw arc',()=>{
  expect(typeof travel.seasonCamera).toBe('function');
  const a=PRESETS['cherry blossom'],b=PRESETS['park 2'];
  const at=w=>travel.seasonCamera(a,b,w);
  for(const k of ['view_extent_m','view_pitch_deg','view_yaw_deg','view_fov_deg','view_center_x','view_center_y']){
    expect(at(0)[k]).toBe(a[k]);expect(at(1)[k]).toBe(b[k]);
  }
  expect(at(.5).view_yaw_deg).toBeCloseTo(202.8802734375,8);
  const height=p=>p.view_extent_m*Math.cos(p.view_pitch_deg*Math.PI/180)**2/(2*Math.tan(p.view_fov_deg*Math.PI/360));
  expect(height(at(.5))).toBeCloseTo((height(a)+height(b))/2,10);
});

test('season travel requires a shared standing grove with a carpet at one end and a full canopy at the other',()=>{
  expect(typeof travel.seasonTravelEligible).toBe('function');
  const a=PRESETS['cherry blossom'],b=PRESETS['park 2'];
  expect(travel.seasonTravelEligible(a,b)).toBe(true);expect(travel.seasonTravelEligible(b,a)).toBe(true);
  for(const change of [{seed:1},{branch_angle_deg:20},{leaf_variety:.9},{standing_scene:false},{faithful_canopy:false},
    {sky_view:true},{receiver:1},{sun_elevation_deg:45},{tone_map:0},{foliage_density:100},{leaf_drop:.2},{litter:1}]){
    expect(travel.seasonTravelEligible(a,{...b,...change}),JSON.stringify(change)).toBe(false);
  }
});

test('fall looks with litter at both ends travel through their shared standing grove',()=>{
  for(const [a,b] of [[PRESETS.montebello,PRESETS['park fall']],[PRESETS['montebello, rain'],PRESETS['cherry blossom']]]){
    expect(travel.seasonTravelEligible(a,b)).toBe(true);
    expect(travel.seasonTravelEligible(b,a)).toBe(true);
    for(const change of [{seed:1},{leaf_shape:'maple'},{branch_tau:0},{sun_azimuth_deg:120},{tone_map:0},{wind_strength:2}]){
      expect(travel.seasonTravelEligible(a,{...b,...change}),JSON.stringify(change)).toBe(false);
    }
  }
});

test('montebello ↔ park fall moves directly between camera eyes without an outward-and-back detour',()=>{
  for(const [a,b] of [[PRESETS.montebello,PRESETS['park fall']],[PRESETS['park fall'],PRESETS.montebello]]){
    const aa=cameraPose(a).eye,bb=cameraPose(b).eye;let previous=aa;
    for(let i=0;i<=600;i++){
      const w=i/600,eye=cameraPose({...a,...travel.seasonCamera(a,b,w)}).eye;
      for(let k=0;k<3;k++){
        expect(eye[k]).toBeCloseTo(aa[k]+(bb[k]-aa[k])*w,10);
        expect((eye[k]-previous[k])*(bb[k]-aa[k])).toBeGreaterThanOrEqual(-1e-12);
      }
      previous=eye;
    }
    expect(Math.abs(travel.seasonCamera(a,b,.999).view_yaw_deg-a.view_yaw_deg)).toBeLessThan(10.31);
  }
});
