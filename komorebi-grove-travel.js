import {TAU,lerp,lerpAngle,smoothstep,leafClock} from './komorebi-math.js';
import {MORPH_KEYS,ANGLE_SET,DEFAULTS,CANOPY_MORPH_MAX} from './komorebi-params.js';
import {seasonCamera} from './komorebi-season-travel.js';
import {litterLanding,litterAlbedo,litterAge} from './komorebi-litter.js';
import {VS_LEAF_TRAVEL,FS_LEAF_TRAVEL,VS_FAITH_SEG,FS_FAITH_SEG} from './komorebi-shaders.js';

const FEAT_DROP = true;
const FEAT_LITTER = true;
export const groveFlightProgress=(t,identity)=>smoothstep(.03+.16*identity,1,t);

// Correspondence uses one rooted grammar; a different seed or child count has no matching branch addresses.
export const groveTravelEligible=FEAT_LITTER?(a,b)=>{
 if(!FEAT_DROP)return false;
 if(!a.faithful_canopy||!b.faithful_canopy||!a.standing_scene||!b.standing_scene||a.sky_view||b.sky_view||a.receiver!==0||b.receiver!==0)return false;
 const floor=a.litter>0&&a.leaf_drop>0?a:b,canopy=floor===a?b:a;
 if(!(floor.litter>0&&floor.leaf_drop>0&&canopy.litter===0&&canopy.leaf_drop===0&&canopy.canopy_fill===0))return false;
 if(floor.layer_count!==3||canopy.layer_count!==4||floor.seed!==canopy.seed||floor.branch_levels!==canopy.branch_levels||floor.branch_children!==canopy.branch_children||floor.limb_count!==canopy.limb_count)return false;
 if((floor.leader_strength>0)!==(canopy.leader_strength>0)||floor.tone_map!==canopy.tone_map||floor.eclipse!==canopy.eclipse)return false;
 for(const p of[a,b])if(p.inner_leaves!==0||p.leaf_variety!==0||p.leaf_diffuse!==0||p.edge_area||p.sway_pitch!==0||p.sun_cosine!==0||p.leaf_size_m<=0||p.branch_tau<=0||!Number.isInteger(p.tree_count)||p.tree_count<1)return false;
 if(floor.tree_count>5||canopy.tree_count>2||floor.tree_count<canopy.tree_count)return false;
 const na=Math.ceil(floor.leaves_per_cluster*floor.foliage_density),nb=Math.ceil(canopy.leaves_per_cluster*canopy.foliage_density);
 const count=floor.tree_count*floor.limb_count*Math.max(1,floor.branch_children)**Math.max(0,floor.branch_levels-1)*na;
 return nb>0&&na>=nb&&count>0&&count<=CANOPY_MORPH_MAX;
}:()=>false;

const read=h=>{const d=new Float32Array(h.faith.count*18);h.gl.bindBuffer(h.gl.ARRAY_BUFFER,h.faith.buf);h.gl.getBufferSubData(h.gl.ARRAY_BUFFER,0,d);return d;};
function leaf(q,i,o){
 const d=q.data,h=q.hub,H=h.hier,j=Math.round(d[i+11]),k=j*4,D=H.clusterData,G=H.clusterGeom,m=h.motion,p=h.params;
 const L=D[k],T=D[k+1],cl=Math.cos(L),sl=Math.sin(L),ct=Math.cos(T),st=Math.sin(T),px=G[k+2],py=G[k+3];
 const dx=d[i]-G[k],dy=d[i+1]-G[k+1],xx=G[k]+ct*dx-st*dy,yy=G[k+1]+st*dx+ct*dy;
 const sw=p.leaf_swing*d[i+6]*(.5*m.u+Math.abs(m.u)*Math.sin(m.time*p.flutter_freq*TAU+d[i+7]));
 const z=D[k+2]+d[i+16]*D[k+3],gain=z/Math.max(h.faith.hMax,.001),th=p.drift_phase+d[i+15];
 const ox=d[i+12]*Math.cos(th),oy=d[i+13]*Math.sin(th),co=Math.cos(d[i+14]),so=Math.sin(d[i+14]);
 o[0]=px+cl*(xx-px)-sl*(yy-py)+m.sway[0]*gain+p.drift_amount*(co*ox+so*oy);
 o[1]=py+sl*(xx-px)+cl*(yy-py)+m.sway[1]*gain+p.drift_amount*(-so*ox+co*oy);
 o[2]=d[i+2];o[3]=d[i+3]*Math.max(.05,Math.abs(Math.cos(d[i+5]+sw)));o[4]=d[i+4]-L-T+.2*sw;o[5]=z;
}
function wood(h,out){
 const H=h.hier,m=h.motion,ref=Math.max(h.faith.hMax,.001);
 for(let i=0;i<h.faith.segRest.length;i++){
  const s=h.faith.segRest[i],o=i*9,th=s.limb>=0?H.limbAngle[s.limb]:0,tt=s.clump>=0?H.twigAngle[s.clump]:0;
  let ax=s.ax,ay=s.ay,bx=s.bx,by=s.by;
  if(tt!==0){const c=Math.cos(tt),sn=Math.sin(tt),dx=ax-s.tbx,dy=ay-s.tby,ex=bx-s.tbx,ey=by-s.tby;ax=s.tbx+c*dx-sn*dy;ay=s.tby+sn*dx+c*dy;bx=s.tbx+c*ex-sn*ey;by=s.tby+sn*ex+c*ey;}
  const c=Math.cos(th),sn=Math.sin(th);
  out[o]=s.px+c*(ax-s.px)-sn*(ay-s.py)+m.sway[0]*s.ha/ref;out[o+1]=s.py+sn*(ax-s.px)+c*(ay-s.py)+m.sway[1]*s.ha/ref;
  out[o+2]=s.px+c*(bx-s.px)-sn*(by-s.py)+m.sway[0]*s.hb/ref;out[o+3]=s.py+sn*(bx-s.px)+c*(by-s.py)+m.sway[1]*s.hb/ref;
  out[o+4]=s.ha;out[o+5]=s.hb;out[o+6]=s.ra;out[o+7]=s.rb;out[o+8]=s.cov;
 }
}
function groups(h){
 const trees=Array.from({length:Math.ceil(h.params.tree_count)},()=>new Map()),counts=new Map();
 for(let i=0;i<h.hier.segments.length;i++){
  const s=h.hier.segments[i],base=`${s.tree}/${s.limb<0?-1:s.limb%h.params.limb_count}/${s.level}`;
  if((s.f0??0)===0)counts.set(base,(counts.get(base)??-1)+1);
  const key=`${base.split('/').slice(1).join('/')}/${counts.get(base)}`,map=trees[s.tree];
  if(!map.has(key))map.set(key,[]);map.get(key).push({i,lo:s.f0??0,hi:s.f1??1});
 }
 return trees;
}
const root=(h,t)=>{const s=h.hier.twigs.find(x=>x.tree===t);return [s.tx,s.ty];};
export function matchGroveTrees(a,b){
 const na=Math.ceil(a.params.tree_count),nb=Math.ceil(b.params.tree_count);if(na<nb)throw Error('Grove correspondence requires at least as many source trees as destination trees');
 let best=Infinity,assignment;
 function search(t,used,rows,cost){if(t===nb){if(cost<best){best=cost;assignment=[...rows];}return;}
  const dst=root(b,t);for(let i=0;i<na;i++)if(!used.has(i)){const src=root(a,i);used.add(i);rows.push(i);search(t+1,used,rows,cost+(src[0]-dst[0])**2+(src[1]-dst[1])**2);rows.pop();used.delete(i);}}
 search(0,new Set(),[],0);
 return Array.from({length:na},(_,i)=>{const primary=assignment.indexOf(i);if(primary>=0)return {target:primary,primary:true};const p=root(a,i);let j=0,c=Infinity;for(let k=0;k<nb;k++){const r=root(b,k),d=(p[0]-r[0])**2+(p[1]-r[1])**2;if(d<c){c=d;j=k;}}return {target:j,primary:false};});
}
function segmentPoint(data,parts,t,out){
 const s=parts.find(x=>t>=x.lo-1e-8&&t<=x.hi+1e-8)??parts.at(-1),o=s.i*9,w=Math.max(0,Math.min(1,(t-s.lo)/(s.hi-s.lo)));
 out[0]=lerp(data[o],data[o+2],w);out[1]=lerp(data[o+1],data[o+3],w);out[2]=lerp(data[o+4],data[o+5],w);out[3]=lerp(data[o+6],data[o+7],w);out[4]=data[o+8];
}

function createGroveRenderer(h,a,b,from,to,host){
 const gl=h.gl,A={hub:a.hub,data:read(h)},B={hub:b.hub,data:read(b.hub)},trees=matchGroveTrees(a.hub,b.hub);
 const ga=groups(a.hub),gb=groups(b.hub),woodPairs=[];
 for(let t=0;t<ga.length;t++)for(const [key,aa]of ga[t]){
  const bb=gb[trees[t].target].get(key);if(!bb)throw Error(`Missing destination branch ${t}/${key}`);
  const cuts=[...new Set([...aa,...bb].flatMap(x=>[x.lo,x.hi]))].sort((x,y)=>x-y);
  for(let k=0;k<cuts.length-1;k++)woodPairs.push({aa,bb,lo:cuts[k],hi:cuts[k+1],primary:trees[t].primary});
 }
 const srcGroups=Array.from({length:h.hier.nClusterTotal},()=>[]),dstGroups=Array.from({length:b.hub.hier.nClusterTotal},()=>[]);
 for(let i=0;i<A.data.length;i+=18)srcGroups[Math.round(A.data[i+11])].push(i);
 for(let i=0;i<B.data.length;i+=18)dstGroups[Math.round(B.data[i+11])].push(i);
 const byTree=Array.from({length:Math.ceil(to.tree_count)},(_,t)=>b.hub.hier.twigs.map((v,i)=>v.tree===t?i:-1).filter(x=>x>=0));
 const ordinal=new Map(),sourceCarpet=new Map(a.hub.grove.litter.map(l=>[`${l.j}/${l.k}`,l])),paths=[];
 const perTreeCount=new Map();for(let j=0;j<h.hier.nClusterTotal;j++){const t=h.hier.twigs[j].tree,k=perTreeCount.get(t)??0;ordinal.set(j,k);perTreeCount.set(t,k+1);}
 for(let j=0;j<srcGroups.length;j++){
  const tree=h.hier.twigs[j].tree,map=trees[tree],target=byTree[map.target][ordinal.get(j)];
  if(target===undefined)throw Error(`Missing target twig ${tree}/${ordinal.get(j)}`);
  const aa=srcGroups[j],bb=dstGroups[target];
  for(let k=0;k<aa.length;k++){
   const slot=Math.min(bb.length-1,Math.floor((k+.5)*bb.length/aa.length)),primary=map.primary&&k===Math.min(aa.length-1,Math.floor((slot+.5)*aa.length/bb.length));
   const l=sourceCarpet.get(`${j}/${k}`),floor=l?{...l,albedo:litterAlbedo(l.tau,litterAge(from,l.D),from.leaf_wetness),land:litterLanding(l,from),baseFade:l.fade}:null;
   paths.push({ia:aa[k],ib:bb[slot],primary,floor,clock:leafClock(from.seed,j,k),retained:a.hub.hier.leafW?.[j*h.hier.nLeaf+k]??1,layer:h.hier.twigs[j].layer});
  }
 }
 if(paths.filter(p=>p.primary).length!==B.data.length/18||new Set(paths.filter(p=>p.primary).map(p=>p.ib)).size!==B.data.length/18)throw Error('Destination leaves must each occur exactly once');
 const n=paths.length,data=new Float32Array(n*12),segments=new Float32Array(woodPairs.length*9),woodA=new Float32Array(a.hub.faith.segRest.length*9),woodB=new Float32Array(b.hub.faith.segRest.length*9);
 const leafProg=h.program(VS_LEAF_TRAVEL,FS_LEAF_TRAVEL),woodProg=h.program(VS_FAITH_SEG,FS_FAITH_SEG);
 const lu=Object.fromEntries(['Origin','Extent','G','Box','LeafA','LeafB','ShapeA','ShapeB','Weight','Edge','BeamK','EdgeArea'].map(k=>[k,gl.getUniformLocation(leafProg,`u${k}`)]));
 const wu=Object.fromEntries(['FaithOrigin','FaithExtent','G','CurtainBake','ClothY','SegSway','WoodTau','SegTau'].map(k=>[k,gl.getUniformLocation(woodProg,`u${k}`)]));
 function buffer(array,stride,attributes){const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,array,gl.DYNAMIC_DRAW);const vao=gl.createVertexArray();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,h.quadBuf);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ARRAY_BUFFER,buf);for(const [loc,size,off]of attributes){gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,stride,off);gl.vertexAttribDivisor(loc,1);}gl.bindVertexArray(null);return {buf,vao};}
 const leaves=buffer(data,48,[[1,4,0],[2,4,16],[3,4,32]]),woodBuf=buffer(segments,36,[[1,4,0],[2,4,16],[3,1,32]]);
 const textures=[null,null],fbos=[gl.createFramebuffer(),gl.createFramebuffer()];let res=0;
 const maxRes=Math.max(from.bake_resolution||from.tex_resolution,to.bake_resolution||to.tex_resolution),maxSamples=Math.max(from.sample_count,to.sample_count);
 const boxes=[h.grove.shape?.box??[0,0,1,1],b.hub.grove.shape?.box??[0,0,1,1]],x0=Math.min(...boxes.map(q=>q[0]-q[2])),x1=Math.max(...boxes.map(q=>q[0]+q[2])),y0=Math.min(...boxes.map(q=>q[1]-q[3])),y1=Math.max(...boxes.map(q=>q[1]+q[3])),box=[(x0+x1)/2,(y0+y1)/2,(x1-x0)/2,(y1-y0)/2];
 const ap=new Float64Array(6),bp=new Float64Array(6),p0=new Float64Array(5),p1=new Float64Array(5),q0=new Float64Array(5),q1=new Float64Array(5);
 const layerData=Array.from({length:3},()=>new Float32Array(n*17)),layerCount=new Uint32Array(3),nativeFaithTex=h.faithTex,originalFillHeights=h.faith.binH.slice();
 const field={tex:textures[0],ox:0,oy:0,ext:1,weight:0};h.trans.active=true;h.trans.seasonTravel=true;h.trans.travelField=field;
 h.motion.u=0;h.motion.sway=[0,0];h.hier.clusterData.fill(0);for(let j=0;j<h.hier.nClusterTotal;j++)h.hier.clusterData[j*4+3]=1;
 gl.bindTexture(gl.TEXTURE_2D,h.clusterTex);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,h.hier.nClusterTotal,1,gl.RGBA,gl.FLOAT,h.hier.clusterData);
 const nativeA={...from},nativeB={...to};let lastTime=0;
 function step(t,dt){
  if(dt>0){if(a.hub.motionActive())a.hub.tick(dt);if(b.hub.motionActive())b.hub.tick(dt);}
  if(t<=0||t>=1){lastTime=t;return;}
  const w=smoothstep(0,1,t),p=h.params;
  for(const key of MORPH_KEYS)p[key]=ANGLE_SET.has(key)?lerpAngle(nativeA[key],nativeB[key],w,key==='drift_phase'?TAU:360):lerp(nativeA[key],nativeB[key],w);
  Object.assign(p,seasonCamera(nativeA,nativeB,w));p.canopy_extent_m=lerp(from.canopy_extent_m,to.canopy_extent_m,w);p.layer_count=3;p.litter=1;p.leaf_shape=from.leaf_shape;p.phenology=from.phenology;p.leaf_wetness=from.leaf_wetness;
  h.perf.auto=host.perf.auto;h.perf.quality=host.perf.quality;h.perf.sampleCount=host.perf.auto?host.faithfulSamples(maxSamples):maxSamples;p.sample_count=maxSamples;h.regenSource();
  const size=host.bakeRes(maxRes);if(res!==size){res=size;for(let i=0;i<2;i++){if(textures[i])gl.deleteTexture(textures[i]);textures[i]=h.makeLayerTexture(res);gl.bindFramebuffer(gl.FRAMEBUFFER,fbos[i]);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,textures[i],0);}field.tex=textures[0];}
  layerCount.fill(0);const carpet=[];let minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity,minH=Infinity,maxH=-Infinity,pad=.2;
  const bulk=h.bulkShift();
  for(let i=0;i<n;i++){
   const path=paths[i],o=i*12,ia=path.ia,ib=path.ib;leaf(A,ia,ap);leaf(B,ib,bp);
   const liveA=path.floor?1:path.retained,fade=lerp(A.data[ia+17]*liveA,B.data[ib+17],w),area=lerp(ap[2]*ap[3],path.primary?bp[2]*bp[3]:0,w),aspect=Math.exp(lerp(Math.log(ap[2]/ap[3]),Math.log(bp[2]/bp[3]),w));
   let x=lerp(ap[0],bp[0],w),y=lerp(ap[1],bp[1],w),z=lerp(ap[5],bp[5],w),angle=lerpAngle(ap[4],bp[4],w,TAU),cast=1,minor=Math.sqrt(area/aspect);
   if(path.floor){
    const l=path.floor,f=groveFlightProgress(t,path.clock),curl=.13*Math.sin(Math.PI*f)*Math.sin(Math.PI*t);
    x=lerp(l.land.x,bp[0],f)+curl*Math.cos(path.clock*TAU);y=lerp(l.land.y,bp[1],f)+curl*Math.sin(path.clock*TAU);z=bp[5]*f;
    angle=lerpAngle(-l.land.rot,bp[4],f,TAU)+.2*Math.sin(Math.PI*f)*Math.sin(path.clock*TAU);minor=lerp(A.data[ia+3],minor,f);cast=smoothstep(0,.13,f);
    l.fade=l.baseFade*(1-smoothstep(0,.18,f));l.flight={x:x-bulk[0]*z,y:y-bulk[1]*z,rot:-angle,albedo:l.albedo};carpet.push(l);
   }
   data[o]=x;data[o+1]=y;data[o+2]=Math.sqrt(area*aspect);data[o+3]=minor;data[o+4]=angle;
   for(let c=0;c<3;c++){const aa=A.data[ia+17]?A.data[ia+8+c]/A.data[ia+17]:0,bb=B.data[ib+17]?B.data[ib+8+c]/B.data[ib+17]:0;data[o+5+c]=lerp(aa,bb,w)*fade*cast;}
   data[o+8]=z;data[o+9]=fade*cast;data[o+10]=(Math.floor((A.data[ia+11]%1)*(h.grove.shape?.idFrac??32)+.5)+.5)/(h.grove.shape?.rows??8);data[o+11]=(Math.floor((B.data[ib+11]%1)*(b.hub.grove.shape?.idFrac??32)+.5)+.5)/(b.hub.grove.shape?.rows??8);
   const li=Math.min(2,path.layer|0),at=layerCount[li]++*17,ld=layerData[li];ld[at]=x;ld[at+1]=y;ld[at+2]=data[o+2];ld[at+3]=minor;ld[at+4]=angle;
   ld[at+5]=ld[at+6]=ld[at+7]=0;for(let c=0;c<3;c++)ld[at+8+c]=data[o+5+c];ld[at+11]=A.data[ia+11]%1;for(let k=12;k<16;k++)ld[at+k]=0;ld[at+16]=data[o+9];
   minx=Math.min(minx,x);maxx=Math.max(maxx,x);miny=Math.min(miny,y);maxy=Math.max(maxy,y);minH=Math.min(minH,z);maxH=Math.max(maxH,z);pad=Math.max(pad,data[o+2]*3,minor*3);
  }
  wood(a.hub,woodA);wood(b.hub,woodB);
  for(let i=0;i<woodPairs.length;i++){
   const q=woodPairs[i],o=i*9;segmentPoint(woodA,q.aa,q.lo,p0);segmentPoint(woodA,q.aa,q.hi,p1);segmentPoint(woodB,q.bb,q.lo,q0);segmentPoint(woodB,q.bb,q.hi,q1);
   segments[o]=lerp(p0[0],q0[0],w);segments[o+1]=lerp(p0[1],q0[1],w);segments[o+2]=lerp(p1[0],q1[0],w);segments[o+3]=lerp(p1[1],q1[1],w);
   segments[o+4]=lerp(p0[2],q0[2],w);segments[o+5]=lerp(p1[2],q1[2],w);segments[o+6]=lerp(p0[3],q.primary?q0[3]:0,w);segments[o+7]=lerp(p1[3],q.primary?q1[3]:0,w);segments[o+8]=lerp(p0[4],q0[4],w);
   for(const k of [0,2]){minx=Math.min(minx,segments[o+k]);maxx=Math.max(maxx,segments[o+k]);miny=Math.min(miny,segments[o+k+1]);maxy=Math.max(maxy,segments[o+k+1]);}maxH=Math.max(maxH,segments[o+4],segments[o+5]);minH=Math.min(minH,segments[o+4],segments[o+5]);
  }
  const proj=h.projMatrix();let gx0=Infinity,gy0=Infinity,gx1=-Infinity,gy1=-Infinity;
  for(let i=0;i<h.src.count;i++){const sx=h.src.flat[i*3],sy=h.src.flat[i*3+1],gx=proj[0]*sx+proj[2]*sy+bulk[0],gy=proj[1]*sx+proj[3]*sy+bulk[1];gx0=Math.min(gx0,gx);gx1=Math.max(gx1,gx);gy0=Math.min(gy0,gy);gy1=Math.max(gy1,gy);}
  const sx0=minx-Math.max(gx0*minH,gx0*maxH,gx1*minH,gx1*maxH),sx1=maxx-Math.min(gx0*minH,gx0*maxH,gx1*minH,gx1*maxH),sy0=miny-Math.max(gy0*minH,gy0*maxH,gy1*minH,gy1*maxH),sy1=maxy-Math.min(gy0*minH,gy0*maxH,gy1*minH,gy1*maxH);
  field.ext=Math.max(sx1-sx0,sy1-sy0)+2*pad;field.ox=(sx0+sx1-field.ext)/2;field.oy=(sy0+sy1-field.ext)/2;field.weight=smoothstep(0,.06,t)*smoothstep(0,.06,1-t);
  gl.bindBuffer(gl.ARRAY_BUFFER,leaves.buf);gl.bufferSubData(gl.ARRAY_BUFFER,0,data);gl.bindBuffer(gl.ARRAY_BUFFER,woodBuf.buf);gl.bufferSubData(gl.ARRAY_BUFFER,0,segments);
  gl.viewport(0,0,res,res);gl.bindFramebuffer(gl.FRAMEBUFFER,fbos[0]);gl.disable(gl.BLEND);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
  for(let i=0;i<h.src.count;i++){
   const sx=h.src.flat[i*3],sy=h.src.flat[i*3+1],gx=proj[0]*sx+proj[2]*sy+bulk[0],gy=proj[1]*sx+proj[3]*sy+bulk[1];
   gl.bindFramebuffer(gl.FRAMEBUFFER,fbos[1]);gl.disable(gl.BLEND);gl.clearColor(1,1,1,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.BLEND);gl.blendFunc(gl.ZERO,gl.SRC_COLOR);
   gl.useProgram(leafProg);gl.bindVertexArray(leaves.vao);gl.uniform2f(lu.Origin,field.ox,field.oy);gl.uniform2f(lu.Extent,field.ext,field.ext);gl.uniform2f(lu.G,gx,gy);gl.uniform4fv(lu.Box,box);gl.uniform1f(lu.Weight,w);gl.uniform1f(lu.Edge,lerp(from.edge_softness,to.edge_softness,w));gl.uniform1f(lu.BeamK,0);gl.uniform1i(lu.EdgeArea,0);
   for(const [unit,q,grove]of [[0,h,h.grove],[1,b.hub,b.hub.grove]]){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,grove.leafTex??q.layerTex[3]);gl.uniform1i(unit===0?lu.LeafA:lu.LeafB,unit);gl.uniform1i(unit===0?lu.ShapeA:lu.ShapeB,grove.shape?1:0);}
   gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,n);
   gl.useProgram(woodProg);gl.bindVertexArray(woodBuf.vao);gl.uniform2f(wu.FaithOrigin,field.ox,field.oy);gl.uniform2f(wu.FaithExtent,field.ext,field.ext);gl.uniform2f(wu.G,gx,gy);gl.uniform2f(wu.SegSway,0,0);gl.uniform1i(wu.CurtainBake,0);gl.uniform1i(wu.SegTau,0);gl.uniform1f(wu.WoodTau,lerp(from.branch_tau,to.branch_tau,w));gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,woodPairs.length);
   gl.bindFramebuffer(gl.FRAMEBUFFER,fbos[0]);gl.blendFunc(gl.ONE,gl.ONE);gl.useProgram(h.progFAcc);gl.bindVertexArray(h.emptyVAO);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,textures[1]);gl.uniform1i(h.U.facc.tex,0);gl.uniform1f(h.U.facc.weight,h.src.flat[i*3+2]);gl.drawArrays(gl.TRIANGLES,0,3);
  }
  gl.disable(gl.BLEND);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  for(let l=0;l<3;l++){gl.bindBuffer(gl.ARRAY_BUFFER,h.layerVAO[l].buf);gl.bufferData(gl.ARRAY_BUFFER,layerData[l].subarray(0,layerCount[l]*17),gl.DYNAMIC_DRAW);h.layerVAO[l].count=layerCount[l];h.faith.binH[l]=lerp(originalFillHeights[l],to.canopy_base_height_m+l/2*to.canopy_thickness_m,w);}
  h.grove.litter=carpet;h.litter.grove=null;h.bakeFill(true);
  lastTime=t;
 }
 function draw(){
  if(lastTime<=0){a.hub.bake();a.draw(null,h.canvas.width,h.canvas.height);return;}
  if(lastTime>=1){b.hub.bake();b.draw(null,h.canvas.width,h.canvas.height);return;}
  const native=lastTime<.5?a:b;if(field.weight<1)native.hub.bake();
  h.faithTex=native.hub.faithTex;for(const k of ['ox','oy','ext'])h.faith[k]=native.hub.faith[k];
  try{h.drawFrameInto(null,h.canvas.width,h.canvas.height);}finally{h.faithTex=nativeFaithTex;}
 }
 return {step,draw,dispose(){
  gl.deleteProgram(leafProg);gl.deleteProgram(woodProg);for(const q of[leaves,woodBuf]){gl.deleteBuffer(q.buf);gl.deleteVertexArray(q.vao);}for(const t of textures)if(t)gl.deleteTexture(t);for(const f of fbos)gl.deleteFramebuffer(f);
 }};
}


const NO_GROVE_TRAVEL={endGroveTravel(){}};
export const makeGroveTravel=FEAT_LITTER?(hub,createScene,adoptScene)=>{
 if(!FEAT_DROP)return NO_GROVE_TRAVEL;
 let s=null;
 function beginGroveTravel(to){
  const from={...hub.params},floor=from.litter>0?from:to;
  // A truncated twig table has no root/branch correspondence for the omitted trees.
  if(floor.tree_count*floor.limb_count*Math.max(1,floor.branch_children)**Math.max(0,floor.branch_levels-1)>hub.MAX_TEX)return false;
  const other=createScene(to),main={hub,draw:hub.drawFrameInto};
  const forward=from.litter>0,a=forward?main:other,b=forward?other:main;
  if(!a.hub.grove.litter?.length){other.dispose();return false;}
  const lookA=forward?from:{...to},lookB=forward?{...to}:from;
  const carrier=createScene({...lookA,leaf_drop:0,litter:0,auto_quality:false,adaptive_motion:false});
  const q=forward?0:1;
  s={a,b,other,carrier,lookA,lookB,start:q,end:1-q,q,pending:null,
   renderer:createGroveRenderer(carrier.hub,a,b,lookA,lookB,hub)};
  return true;
 }
 function retargetGroveTravel(to,opts){
  const same=p=>Object.keys(DEFAULTS).every(k=>k==='drift_phase'||k==='auto_quality'||k==='adaptive_motion'||p[k]===to[k]);
  const end=same(s.lookA)?0:same(s.lookB)?1:null;
  if(end===null){s.pending={to,opts};hub.trans.onEnd=null;return;}
  s.pending=null;s.start=s.q;s.end=end;hub.trans.to=to;hub.trans.t=0;
  hub.trans.dur=Math.max(1e-3,opts.duration??hub.trans.dur);hub.trans.onEnd=opts.onEnd??null;
 }
 function stepGroveTravel(dt,t){s.q=lerp(s.start,s.end,t);s.renderer.step(s.q,dt);}
 function drawGroveTravel(){s.renderer.draw();}
 function finishGroveTravel(){adoptScene(s.end===0?s.a:s.b,hub.trans.to);return s.pending;}
 function endGroveTravel(){if(!s)return;const pending=s.pending;s.renderer.dispose();s.carrier.dispose();s.other.dispose();s=null;return pending;}
 return {beginGroveTravel,retargetGroveTravel,stepGroveTravel,drawGroveTravel,finishGroveTravel,endGroveTravel};
}:()=>NO_GROVE_TRAVEL;
