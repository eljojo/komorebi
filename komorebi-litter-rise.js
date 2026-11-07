// Litter or shadow footprints become the overhead grove through one leaf field.
// Flight is an authored transition path, with live destination wind and a deterministic detour around the eye.
import {cameraPose,lerp,lerpAngle,smoothstep,DEG,TAU,leafClock,atmosphere,ballisticK} from './komorebi-math.js';
import {CANOPY_KEYS,TOPO_KEYS,SEASON_KEYS,DEFAULTS,CANOPY_MORPH_MAX} from './komorebi-params.js';
import {pairLeaves,moveLeaves} from './komorebi-leaf-travel.js';
import {VS_RISE,FS_RISE,VS_RISE_SKY,FS_RISE_SKY} from './komorebi-shaders.js';
import {litterLanding,litterAlbedo,litterAge} from './komorebi-litter.js';
import {leafVariant} from './komorebi-leaf.js';
export function riseCamera(a,b,t){
 const w=smoothstep(.06,.95,t),gaze=smoothstep(.07,.68,t),A=cameraPose(a),B=cameraPose(b);
 return {eye:A.eye.map((v,i)=>w===1?B.eye[i]:lerp(v,B.eye[i],w)),elevation:gaze===1?B.elevation:lerp(A.elevation,B.elevation,gaze),
  yaw:lerpAngle(a.view_yaw_deg,b.view_yaw_deg,w,360),fov:lerp(a.view_fov_deg,b.view_fov_deg,w),skyWeight:w,weight:w};
}
export function riseBasis(q){
 const c=Math.cos(q.elevation),s=Math.sin(q.elevation),cy=Math.cos(q.yaw*DEG),sy=Math.sin(q.yaw*DEG);
 return [cy,-sy,0,-sy*s,-cy*s,c,sy*c,cy*c,s];
}
export function riseLeaf(a,b,t,identity){
 const f=smoothstep(.04+.1*identity,.78+.1*identity,t),rise=f*(2-f),curl=.22*Math.sin(Math.PI*f),phi=identity*6.28318530718+2*f;
 const position=f===0?[...a]:f===1?[...b]:[lerp(a[0],b[0],f)+curl*Math.cos(phi),lerp(a[1],b[1],f)+curl*Math.sin(phi),lerp(a[2],b[2],rise)];
 const air=smoothstep(0,.1,f);
 return {position,flight:f,air,floor:1-air,translucent:smoothstep(.015,.15,f)};
}
export function riseBypass(p,plan,t){
 if(!plan)return p;
 const w=t<plan.at?smoothstep(plan.start,plan.at,t):1-smoothstep(plan.at,plan.end,t);
 return p.map((v,i)=>v+plan.axis[i]*plan.amount*w);
}
// Many carriers share a carpet identity. Cache its flight samples and the camera once per journey,
// then solve clearance in scalar coordinates; the approved path and clearance thresholds stay the same.
function risePlanner(from,to){
 const eyes=Array.from({length:100},(_,i)=>riseCamera(from,to,i/100).eye),paths=new Map(),relative=new Float64Array(300);
 return (a,b,id)=>{
  let path=paths.get(id);
  if(!path){
   path=new Float64Array(400);
   for(let i=1;i<100;i++){
    const f=smoothstep(.04+.1*id,.78+.1*id,i/100),o=i*4,curl=f===0||f===1?0:.22*Math.sin(Math.PI*f),phi=id*6.28318530718+2*f;
    path[o]=f;path[o+1]=curl*Math.cos(phi);path[o+2]=curl*Math.sin(phi);path[o+3]=f*(2-f);
   }
   paths.set(id,path);
  }
  function sample(i){
   const o=i*4,j=i*3,f=path[o],e=eyes[i];
   relative[j]=(f===1?b[0]:lerp(a[0],b[0],f)+path[o+1])-e[0];
   relative[j+1]=(f===1?b[1]:lerp(a[1],b[1],f)+path[o+2])-e[1];
   relative[j+2]=lerp(a[2],b[2],path[o+3])-e[2];
  }
  let at=0,d=Infinity;
  for(let i=2;i<100;i+=2){sample(i);const j=i*3,dist=Math.hypot(relative[j],relative[j+1],relative[j+2]);if(dist<d){d=dist;at=i/100;}}
  if(d>1.1)return null;
  const offset=t=>{const p=riseLeaf(a,b,t,id).position,e=riseCamera(from,to,t).eye;return p.map((v,i)=>v-e[i]);};
  const ra=offset(at-.002),rb=offset(at+.002),vx=rb[0]-ra[0],vy=rb[1]-ra[1],len=Math.hypot(vx,vy);
  const axis=len>.00001?[vy/len,-vx/len,0]:[1,0,0],r=offset(at),dot=r[0]*axis[0]+r[1]*axis[1];
  const sign=Math.abs(dot)<.001?(id<.5?-1:1):Math.sign(dot);axis[0]*=sign;axis[1]*=sign;
  const plan={axis,at,start:.04+.1*id,end:.9,amount:1.1},weights=new Float64Array(100);
  for(let i=1;i<100;i++){
   if(i%2)sample(i);
   const t=i/100;weights[i]=t<at?smoothstep(plan.start,at,t):1-smoothstep(at,plan.end,t);
  }
  for(let pass=0;pass<8;pass++){
   let distance=Infinity;
   for(let i=1;i<100;i++){
    const j=i*3,w=plan.amount*weights[i];
    distance=Math.min(distance,Math.hypot(relative[j]+axis[0]*w,relative[j+1]+axis[1]*w,relative[j+2]));
   }
   if(distance>.92)break;plan.amount*=1.4;
  }
  return plan;
 };
}
export function planRiseBypass(a,b,id,from,to){return risePlanner(from,to)(a,b,id);}

const FEAT_LITTER = true;
const FEAT_DROP = true;
const FEAT_LEAF_DIFFUSE = true;
const FEAT_SKY_FLIGHT = true;
const RISE_KEYS=new Set([...CANOPY_KEYS,...TOPO_KEYS,...SEASON_KEYS,
  'view_extent_m','view_pitch_deg','view_yaw_deg','view_fov_deg','view_center_x','view_center_y',
  'sky_view','faithful_canopy','standing_scene','sun_elevation_deg','sun_azimuth_deg','sky_turbidity','core_angular_radius_deg',
  'canopy_fill','canopy_base_height_m','canopy_thickness_m','branch_tau','trunk_radius_m','far_smear','litter','litter_age','litter_drift_m','leaf_wetness','drift_phase',
  'sample_count','bake_resolution','tex_resolution','auto_quality','adaptive_motion','adaptive_idle_fps','show_source','show_layer','show_layer_index','tree_species']);
export const litterRiseEligible=FEAT_LITTER ? FEAT_DROP ? (a,b)=>{
  const count=p=>Math.ceil(Math.max(1,p.tree_count))*p.limb_count*Math.max(1,p.branch_children)**Math.max(0,p.branch_levels-1);
  return !a.sky_view&&b.sky_view&&a.faithful_canopy&&!b.faithful_canopy&&a.standing_scene&&b.standing_scene
    &&a.receiver===0&&b.receiver===0&&a.litter>0&&a.leaf_drop>0&&b.litter===0&&b.leaf_drop===0&&b.branch_tau===0
    &&a.leaf_diffuse===0&&b.leaf_diffuse===0&&a.sun_cosine===0&&b.sun_cosine===0
    &&a.inner_leaves===0&&b.inner_leaves===0&&a.leaf_variety===0&&b.leaf_variety===0
    &&a.layer_count===3&&b.layer_count===3&&a.seed===b.seed
    &&a.leaf_size_m>0&&b.leaf_size_m>0&&Math.max(a.leaf_size_m,b.leaf_size_m)<=.2
    &&90-a.view_pitch_deg>a.view_fov_deg/2&&b.view_pitch_deg>b.view_fov_deg/2
    &&b.canopy_base_height_m>cameraPose(a).eye[2]
    &&Math.max(count(a),count(b))*Math.max(Math.ceil(a.leaves_per_cluster*a.foliage_density),Math.ceil(b.leaves_per_cluster*b.foliage_density))<=CANOPY_MORPH_MAX
    &&Object.keys(DEFAULTS).every(k=>RISE_KEYS.has(k)||a[k]===b[k]);
}:()=>false:()=>false;

// Shadow footprints have no carpet or standing-tree throw. The eye renderer currently lands on three sky planes.
export const shadowRiseEligible=FEAT_SKY_FLIGHT ? (a,b)=>{
 const count=p=>Math.ceil(Math.max(1,p.tree_count))*p.limb_count*Math.max(1,p.branch_children)**Math.max(0,p.branch_levels-1);
 return !a.sky_view&&b.sky_view&&a.faithful_canopy&&!b.faithful_canopy&&!a.standing_scene&&b.standing_scene
  &&a.receiver===0&&b.receiver===0&&a.branch_tau===0&&b.branch_tau===0
  &&a.canopy_fill===0&&b.canopy_fill===0&&a.litter===0&&b.litter===0&&a.leaf_drop===0&&b.leaf_drop===0
  &&a.inner_leaves===0&&b.inner_leaves===0&&a.leaf_diffuse>=0&&a.leaf_diffuse<1&&b.leaf_diffuse===0
  &&a.sun_cosine===0&&b.sun_cosine===0&&a.eclipse===b.eclipse&&!a.edge_area&&!b.edge_area
  &&b.layer_count===3&&a.leaf_size_m>0&&b.leaf_size_m>0&&Math.max(a.leaf_size_m,b.leaf_size_m)<=.2
  &&a.tree_count>0&&b.tree_count>0&&a.foliage_density>0&&b.foliage_density>0&&a.leaves_per_cluster>0&&b.leaves_per_cluster>0
  &&90-a.view_pitch_deg>a.view_fov_deg/2&&b.view_pitch_deg>b.view_fov_deg/2
  &&Math.max(count(a),count(b))*Math.max(Math.ceil(a.leaves_per_cluster*a.foliage_density),Math.ceil(b.leaves_per_cluster*b.foliage_density))<=CANOPY_MORPH_MAX;
}:()=>false;

function makeRiseRenderer(hub,source,from,to,footprints=false){
 const a=source,b={hub},canvas=hub.canvas,h=a.hub,g=hub.gl;
 const read=h=>{
  const leaves=new Float32Array(h.faith.count*18);
  g.bindBuffer(g.ARRAY_BUFFER,h.faith.buf);g.getBufferSubData(g.ARRAY_BUFFER,0,leaves);
  return {leaves,hier:h.hier,params:h.params,motion:h.motion,hMax:h.faith.hMax,shape:h.grove.shape,texture:h.grove.leafTex};
 };
 let A,ids,litter,fades,reflectance;
 if(footprints){
  A=read(h);ids=Array.from({length:A.leaves.length/18},(_,i)=>leafClock(from.seed,Math.round(A.leaves[18*i+11]),i));
  // The source beam's ballistic depth becomes a filter at its ground footprint.
  const extra=FEAT_LEAF_DIFFUSE?ballisticK(from.leaf_diffuse):0;
  for(let i=0;i<A.leaves.length;i+=18)for(let c=0;c<3;c++)A.leaves[i+8+c]+=extra;
 }else{
  litter=h.grove.litter.map(l=>({...l}));fades=litter.map(l=>l.fade);ids=litter.map(l=>leafClock(from.seed,l.j,l.k));
  const ground=new Float32Array(litter.length*18),n=h.hier.nClusterTotal;
  reflectance=new Float32Array(litter.length*3);
  const H={nClusterTotal:n,clusterData:new Float32Array(n*4),clusterGeom:new Float32Array(n*4),clusterPlan:new Float32Array(n*2)},count=new Uint32Array(n);
  for(let i=0;i<litter.length;i++){
   const l=litter[i],p=litterLanding(l,from),o=18*i,row=l.row??leafVariant(from.seed,l.j,l.k);
   ground[o]=p.x;ground[o+1]=p.y;ground[o+2]=l.size[0];ground[o+3]=l.size[1];ground[o+4]=-p.rot;
   for(let c=0;c<3;c++)ground[o+8+c]=l.tau[c]*l.fade;
   ground[o+11]=l.j+row/(h.grove.shape?.idFrac??32);ground[o+17]=l.fade;
   H.clusterPlan[2*l.j]+=p.x;H.clusterPlan[2*l.j+1]+=p.y;count[l.j]++;
   reflectance.set(litterAlbedo(l.tau,litterAge(from,l.D),from.leaf_wetness),3*i);
  }
  for(let j=0;j<n;j++)if(count[j]){H.clusterPlan[j*2]/=count[j];H.clusterPlan[j*2+1]/=count[j];}
  A={leaves:ground,hier:H,params:{...from,faithful_canopy:true,drift_amount:0,leaf_swing:0},motion:{time:0,u:0,sway:[0,0]},hMax:1,shape:h.grove.shape,texture:h.grove.leafTex};
 }
 const B=read(b.hub);
 const pairs=pairLeaves(A,B),starts=new Float32Array(pairs.length*12),ends=starts.slice(),data=starts.slice(),material=new Float32Array(pairs.length*4),flights=material.slice();
 moveLeaves(A,B,pairs,0,starts);
 const ba=A.shape?.box??[0,0,1,1],bb=B.shape?.box??[0,0,1,1],lo=[0,1].map(i=>Math.min(ba[i]-ba[i+2],bb[i]-bb[i+2])),hi=[0,1].map(i=>Math.max(ba[i]+ba[i+2],bb[i]+bb[i+2]));
 const box=[(lo[0]+hi[0])/2,(lo[1]+hi[1])/2,(hi[0]-lo[0])/2,(hi[1]-lo[1])/2];
 const skyProgram=h.program(VS_RISE_SKY,FS_RISE_SKY),leafProgram=h.program(VS_RISE,FS_RISE);
 const locs=(p,names)=>Object.fromEntries(names.map(k=>[k,g.getUniformLocation(p,`u${k}`)]));
 const su=locs(skyProgram,['Origin','Extent','Box','LeafA','LeafB','ShapeA','ShapeB','Edge','Band','Heights','Eye']);
 const lu=locs(leafProgram,['Eye','Basis','Fov','Aspect','Box','LeafA','LeafB','ShapeA','ShapeB','Faith','FillT','FillS','FaithOrigin','FaithExtent','FillOrigin','FillExtent','FillShare','Sun','Ambient','Edge']);
 const vao=g.createVertexArray(),buf=g.createBuffer(),matBuf=g.createBuffer(),flightBuf=g.createBuffer();g.bindVertexArray(vao);
 g.bindBuffer(g.ARRAY_BUFFER,h.quadBuf);g.enableVertexAttribArray(0);g.vertexAttribPointer(0,2,g.FLOAT,false,0,0);
 for(const [buffer,array,first,slots] of [[buf,data,1,3],[matBuf,material,4,1],[flightBuf,flights,5,1]]){
  g.bindBuffer(g.ARRAY_BUFFER,buffer);g.bufferData(g.ARRAY_BUFFER,array,g.DYNAMIC_DRAW);
  for(let i=0;i<slots;i++){g.enableVertexAttribArray(first+i);g.vertexAttribPointer(first+i,4,g.FLOAT,false,slots*16,i*16);g.vertexAttribDivisor(first+i,1);}
 }
 const resolution=hub.bakeRes(),layers=[0,1,2,3].map(i=>h.makeLayerTexture(i<3?resolution:1)),layerFbo=g.createFramebuffer(),eyeFbo=g.createFramebuffer(),eyeTex=[h.makeLayerTexture(1),h.makeLayerTexture(1)];
 let fieldW=0,fieldH=0;
 function ensureEye(){
  const scale=Math.min(2,hub.MAX_TEX/Math.max(canvas.width,canvas.height)),w=Math.max(1,Math.floor(canvas.width*scale)),height=Math.max(1,Math.floor(canvas.height*scale));
  if(w===fieldW&&height===fieldH)return;
  g.bindFramebuffer(g.FRAMEBUFFER,eyeFbo);
  for(let i=0;i<2;i++){g.bindTexture(g.TEXTURE_2D,eyeTex[i]);g.texImage2D(g.TEXTURE_2D,0,g.RGBA16F,w,height,0,g.RGBA,g.HALF_FLOAT,null);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0+i,g.TEXTURE_2D,eyeTex[i],0);}
  g.drawBuffers([g.COLOR_ATTACHMENT0,g.COLOR_ATTACHMENT1]);
  if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)hub.fail('flying-leaf targets incomplete');
  fieldW=w;fieldH=height;g.bindFramebuffer(g.FRAMEBUFFER,null);
 }
 const heights=Array.from(b.hub.layerHeights()).slice(0,3),atm={sun:[0,0,0],ambient:[0,0,0]};
 const shapes=u=>{for(const [unit,q]of[[0,A],[1,B]]){g.activeTexture(g.TEXTURE0+unit);g.bindTexture(g.TEXTURE_2D,q.texture??b.hub.layerTex[3]);g.uniform1i(unit===0?u.LeafA:u.LeafB,unit);g.uniform1i(unit===0?u.ShapeA:u.ShapeB,q.shape?1:0);}g.uniform4fv(u.Box,box);};
 let bypasses=null,planner=null,planEnds=null,planned=0;
 function carriers(t){
  if(footprints)moveLeaves(A,B,pairs,0,starts);
  moveLeaves(A,B,pairs,1,ends);
  if(t>0&&!bypasses){
   bypasses=new Array(pairs.length);planner=risePlanner(from,to);planEnds=ends.slice();
  }
  if(planner){
   // Preparation fits inside the pickup pause. Freeze one destination pose and finish before any leaf lifts.
   const until=t>=.035?pairs.length:Math.min(pairs.length,planned+Math.ceil(pairs.length/12));
   for(;planned<until;planned++){
    const o=planned*12;
    bypasses[planned]=planner([starts[o],starts[o+1],0],[planEnds[o],planEnds[o+1],planEnds[o+8]],ids[pairs[planned][0]/18]);
   }
   if(planned===pairs.length){planner=null;planEnds=null;}
  }
  if(!footprints){
   for(let i=0;i<litter.length;i++){const q=riseLeaf([0,0,0],[0,0,1],t,ids[i]);litter[i].fade=fades[i]*q.floor;}
   h.grove.litter=litter;h.litter.grove=null;
  }
  for(let i=0;i<pairs.length;i++){
   const o=i*12,m=i*4,source=pairs[i][0]/18,id=ids[source],q=riseLeaf([starts[o],starts[o+1],0],[ends[o],ends[o+1],ends[o+8]],t,id),w=q.flight;
   const position=riseBypass(q.position,bypasses?.[i],t);data[o]=position[0];data[o+1]=position[1];data[o+8]=position[2];
   const area=lerp(starts[o+2]*starts[o+3],ends[o+2]*ends[o+3],w);
   const a0=starts[o+2]>0?starts[o+2]/starts[o+3]:ends[o+2]/ends[o+3],a1=ends[o+2]>0?ends[o+2]/ends[o+3]:a0;
   const aspect=Math.exp(lerp(Math.log(a0),Math.log(a1),w));data[o+2]=Math.sqrt(area*aspect);data[o+3]=Math.sqrt(area/aspect);
   data[o+4]=lerpAngle(starts[o+4],ends[o+4],w,TAU);
   for(let c=0;c<3;c++)data[o+5+c]=lerp(starts[o+5+c],ends[o+5+c],w);
   data[o+9]=lerp(starts[o+9],ends[o+9],w);data[o+10]=starts[o+10];data[o+11]=ends[o+11];
   if(footprints){material[m]=material[m+1]=material[m+2]=0;material[m+3]=1;}
   else{material.set(reflectance.subarray(source*3,source*3+3),m);material[m+3]=q.translucent;}
   flights[m]=footprints?smoothstep(0,.10,t):q.air;flights[m+1]=Math.sin(Math.PI*w)*.75*Math.sin(id*TAU+6*w);flights[m+2]=w;
  }
  for(const [buffer,array]of[[buf,data],[matBuf,material],[flightBuf,flights]]){g.bindBuffer(g.ARRAY_BUFFER,buffer);g.bufferSubData(g.ARRAY_BUFFER,0,array);}
 }
 function bakeEye(q){
  atmosphere(atm,h.params.sun_elevation_deg,h.params.sky_turbidity,h.params.ambient_skylight);
  g.bindFramebuffer(g.FRAMEBUFFER,eyeFbo);g.viewport(0,0,fieldW,fieldH);g.clearColor(0,0,0,0);g.clear(g.COLOR_BUFFER_BIT);
  g.enable(g.BLEND);g.blendFunc(g.ONE,g.ONE);g.useProgram(leafProgram);g.bindVertexArray(vao);shapes(lu);
  g.uniform3fv(lu.Eye,q.eye);g.uniformMatrix3fv(lu.Basis,false,riseBasis(q));g.uniform1f(lu.Fov,q.fov*DEG);g.uniform1f(lu.Aspect,canvas.width/canvas.height);g.uniform1f(lu.Edge,lerp(from.edge_softness,to.edge_softness,q.weight));
  for(const [unit,tex,key]of[[2,h.faithTex,'Faith'],[3,h.fill.tex[0],'FillT'],[4,h.fill.tex[1],'FillS']]){g.activeTexture(g.TEXTURE0+unit);g.bindTexture(g.TEXTURE_2D,tex??h.layerTex[3]);g.uniform1i(lu[key],unit);}
  g.uniform2f(lu.FaithOrigin,h.faith.ox,h.faith.oy);g.uniform1f(lu.FaithExtent,h.faith.ext);g.uniform2f(lu.FillOrigin,h.fill.ox,h.fill.oy);g.uniform1f(lu.FillExtent,h.fill.ext);g.uniform1f(lu.FillShare,h.fill.ready?from.canopy_fill:0);
  g.uniform3fv(lu.Sun,atm.sun);g.uniform3fv(lu.Ambient,atm.ambient);g.drawArraysInstanced(g.TRIANGLE_STRIP,0,4,pairs.length);g.disable(g.BLEND);
 }
 function bakeSky(q){
  const extent=lerp(from.canopy_extent_m,to.canopy_extent_m,q.weight);
  g.bindFramebuffer(g.FRAMEBUFFER,layerFbo);g.viewport(0,0,resolution,resolution);g.enable(g.BLEND);g.blendFunc(g.ONE,g.ONE);g.useProgram(skyProgram);g.bindVertexArray(vao);shapes(su);
  g.uniform2f(su.Origin,-extent/2,-extent/2);g.uniform2f(su.Extent,extent,extent);g.uniform3fv(su.Heights,heights);g.uniform3fv(su.Eye,q.eye);g.uniform1f(su.Edge,lerp(from.edge_softness,to.edge_softness,q.weight));
  for(let i=0;i<3;i++){g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,layers[i],0);g.clearColor(0,0,0,0);g.clear(g.COLOR_BUFFER_BIT);g.uniform1f(su.Band,i);g.drawArraysInstanced(g.TRIANGLE_STRIP,0,4,pairs.length);}
  g.disable(g.BLEND);g.bindFramebuffer(g.FRAMEBUFFER,null);return {textures:layers,heights,extent};
 }

 function step(t,dt){
  const q=riseCamera(from,to,t),p=h.params;
  if(footprints){
   for(const k of ['core_weight_fraction','halo_angular_radius_deg','cloud_thickness','exposure','contrast','ambient_skylight','sky_turbidity','mesopic_strength','chromatic_aberration','vignette','vignette_shape','ground_r','ground_g','ground_b','sky_scatter','glow_bleed','glow_bleed_m'])p[k]=lerp(from[k],to[k],q.weight);
   h.trans.travelTone=[0,0,0];h.trans.travelTone[from.tone_map]+=1-q.weight;h.trans.travelTone[to.tone_map]+=q.weight;
   h.trans.irisRadius=from.vignette>0&&to.vignette===0?lerp(1,Math.SQRT2,smoothstep(.75,1,t))
    :from.vignette===0&&to.vignette>0?lerp(Math.SQRT2,1,smoothstep(0,.25,t)):1;
  }
  for(const k of ['view_extent_m','view_center_x','view_center_y','view_pitch_deg','sun_elevation_deg','sun_azimuth_deg','sky_turbidity','core_angular_radius_deg'])p[k]=lerp(from[k],to[k],q.weight);
  p.view_fov_deg=q.fov;p.view_yaw_deg=q.yaw;
  if(dt>0&&h.motionActive())h.tick(dt);
  h.regenSource();carriers(t);h.bake();hub.bake();
  if(t>0){
   ensureEye();bakeEye(q);
   // The native target atlas takes over only after the moving carriers arrive.
   const atlas=t>=.9?{textures:hub.layerTex,heights:hub.layerHeights(),extent:to.canopy_extent_m}:bakeSky(q);
   h.trans.riseField={depth:eyeTex[0],emission:eyeTex[1],shadow:footprints,weight:footprints?smoothstep(0,.10,t):0,native:smoothstep(.9,.995,t),step:[.5/fieldW,.5/fieldH],atlas};
   Object.assign(h.trans,{active:true,viewpoint:true,t,viewEye:q.eye,viewElevation:q.elevation,viewSkyWeight:q.skyWeight});
  }else{h.trans.active=false;h.trans.riseField=null;}
 }
 function draw(){a.draw(null,canvas.width,canvas.height);}
 return {step,draw,dispose(){
  h.trans.riseField=null;a.dispose();
  [skyProgram,leafProgram].forEach(p=>{g.deleteProgram(p);});[buf,matBuf,flightBuf].forEach(b=>{g.deleteBuffer(b);});g.deleteVertexArray(vao);
  [...layers,...eyeTex].forEach(t=>{g.deleteTexture(t);});g.deleteFramebuffer(layerFbo);g.deleteFramebuffer(eyeFbo);
 }};
}

const NO_LITTER_RISE={endLitterRise(){}};
export const makeLitterRise=FEAT_SKY_FLIGHT ? (hub,createSource)=>{
 let s=null;
 function beginLitterRise(to,footprints=false){s={source:createSource(),from:{...hub.params},to:{...to},footprints,renderer:null,pending:null};}
 function stepLitterRise(dt,t){if(!s.renderer)s.renderer=makeRiseRenderer(hub,s.source,s.from,s.to,s.footprints);s.renderer.step(t,dt);}
 function drawLitterRise(){s.renderer.draw();}
 function retargetLitterRise(to,opts){s.pending={to,opts};hub.trans.onEnd=null;}
 function finishLitterRise(){return s.pending;}
 function endLitterRise(){
  if(!s)return;
  const pending=s.pending;
  if(s.renderer)s.renderer.dispose();else s.source.dispose();
  s=null;hub.trans.shadowRise=false;return pending;
 }
 return {beginLitterRise,stepLitterRise,drawLitterRise,retargetLitterRise,finishLitterRise,endLitterRise};
}:()=>NO_LITTER_RISE;
