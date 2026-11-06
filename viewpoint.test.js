import { test, expect } from 'bun:test';
import * as math from './komorebi-math.js';
import { DEFAULTS, CAMERAS, TRANSPORT_GROUPS, buildTransport } from './komorebi.js';

test('cameraPose expresses the authored sky and floor frames in one world coordinate system',()=>{
  expect(typeof math.cameraPose).toBe('function');
  const sky=math.cameraPose({...DEFAULTS,sky_view:true,view_pitch_deg:80,view_center_x:0.3,view_center_y:-0.2});
  expect(sky.eye).toEqual([0.3,-0.2,0]);
  expect(sky.elevation).toBeCloseTo(80*Math.PI/180,12);
  for(const pitch of [0,16,40])for(const yaw of [-35,0,125])for(const fov of [35,64,100]) {
    const p={...DEFAULTS,sky_view:false,view_pitch_deg:pitch,view_yaw_deg:yaw,view_fov_deg:fov,view_extent_m:3.1,view_center_x:.3,view_center_y:-.2};
    const pose=math.cameraPose(p),a=pitch*Math.PI/180,k=Math.tan(fov*Math.PI/360),y=yaw*Math.PI/180;
    const h=3.1*Math.cos(a)**2/(2*k);
    expect(pose.eye[2]).toBeCloseTo(h,12);
    for(const [u,v] of [[0,0],[.5,.5],[1,.2],[.1,1]]) {
      const x=2*k*(u-.5)*16/9,dy=Math.sin(a)+2*k*(v-.5)*Math.cos(a),dz=-Math.cos(a)+2*k*(v-.5)*Math.sin(a);
      if(dz>=-1e-4)continue;   // the authored floor hands these rays to haze
      const wx=h*x/-dz,wy=h*(dy/-dz-Math.tan(a));
      const native=[.3+Math.cos(y)*wx+Math.sin(y)*wy,-.2-Math.sin(y)*wx+Math.cos(y)*wy];
      const hit=[pose.eye[0]+h*(Math.cos(y)*x+Math.sin(y)*dy)/-dz,pose.eye[1]+h*(-Math.sin(y)*x+Math.cos(y)*dy)/-dz];
      expect(hit[0]).toBeCloseTo(native[0],10);expect(hit[1]).toBeCloseTo(native[1],10);
    }
  }
});

test('the viewpoint program uses the same canopy ray and sun cast with one continuous eye',()=>{
  expect(CAMERAS.viewpoint).toBeDefined();
  const src=buildTransport('viewpoint');
  expect(TRANSPORT_GROUPS.viewpoint.locs.eye).toBe('uViewEye');
  expect(src).toContain('if(dir.z > 0.0)');
  expect(src).toContain('skyRay(');
  for(let i=0;i<4;i++) expect(src).toContain(`uLayerHeight[${i}]>eye.z ?`);
  expect(src).toContain('world = uViewEye.xy + dir.xy*(uViewEye.z/max(-dir.z,1e-6));');
  expect(src).toContain('for(int i=0;i<MAX_SAMPLES;i++)');
  expect(src.split('void texelMix(')).toHaveLength(2);
  expect(src.split('uniform float uBeamK;')).toHaveLength(2);
});
