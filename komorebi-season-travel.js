import {DEG, TAU, cameraPose, leafClock, lerp, lerpAngle, smoothstep, turnBack} from './komorebi-math.js';
import {CANOPY_MORPH_MAX, DEFAULTS, SEASON_KEYS} from './komorebi-params.js';
import {litterAlbedo,litterAge,litterLanding} from './komorebi-litter.js';
import {makeBake} from './komorebi-bake.js';
import {makeSource} from './komorebi-source.js';
import {VS_SEASON_TRAVEL,FS_FAITH} from './komorebi-shaders.js';
const FEAT_DROP = true;
const FEAT_LITTER = true;
const CAMERA_KEYS=['view_extent_m','view_pitch_deg','view_yaw_deg','view_fov_deg','view_center_x','view_center_y'];
const LOOK_KEYS=['canopy_fill','leaf_diffuse','leaf_wetness','ground_r','ground_g','ground_b','cloud_thickness','halo_angular_radius_deg','sky_turbidity'];
// Re-season can recolour a leaf, but the flight route still requires the same authored summer tint.
const SEASON_ROUTE_KEYS=new Set([...SEASON_KEYS.filter(k=>!['trans_r','trans_g','trans_b'].includes(k)),...CAMERA_KEYS,'drop_after_turn','litter','litter_age','litter_drift_m',
  ...LOOK_KEYS,'sample_count','bake_resolution','drift_phase','auto_quality','adaptive_motion','adaptive_idle_fps','show_source','show_layer','show_layer_index','tree_species']);

export const flightProgress=(season,identity)=>smoothstep(0,1,(season-(.04+.26*identity))/.65);

// Interpolate a real eye rather than the floor camera's coupled extent, tilt and recenter gauges.
export function seasonCamera(a,b,w){
  if(w===0||w===1)return Object.fromEntries(CAMERA_KEYS.map(k=>[k,(w===0?a:b)[k]]));
  const aa=cameraPose(a).eye,bb=cameraPose(b).eye,eye=aa.map((x,i)=>lerp(x,bb[i],w));
  const yaw=lerpAngle(a.view_yaw_deg,b.view_yaw_deg,w,360),pitch=lerp(a.view_pitch_deg,b.view_pitch_deg,w),fov=lerp(a.view_fov_deg,b.view_fov_deg,w);
  const offset=eye[2]*Math.tan(pitch*DEG);
  return {view_extent_m:2*Math.tan(fov*DEG/2)*eye[2]/Math.cos(pitch*DEG)**2,view_pitch_deg:pitch,view_yaw_deg:yaw,view_fov_deg:fov,
    view_center_x:eye[0]+offset*Math.sin(yaw*DEG),view_center_y:eye[1]+offset*Math.cos(yaw*DEG)};
}

export const seasonTravelEligible=FEAT_LITTER ? (a,b)=>{
  if(!FEAT_DROP)return false;
  if(!a.faithful_canopy||!b.faithful_canopy||!a.standing_scene||!b.standing_scene||a.sky_view||b.sky_view||a.receiver!==0||b.receiver!==0||a.leaf_variety!==0||b.leaf_variety!==0)return false;
  const fallenA=a.litter>0&&a.leaf_drop>0,fallenB=b.litter>0&&b.leaf_drop>0;
  const supported=fallenA&&(fallenB||b.litter===0&&b.leaf_drop===0)||fallenB&&a.litter===0&&a.leaf_drop===0;
  if(!supported||Object.keys(DEFAULTS).some(k=>!SEASON_ROUTE_KEYS.has(k)&&a[k]!==b[k]))return false;
  const leaves=Math.ceil(Math.max(1,a.tree_count))*a.limb_count*Math.max(1,a.branch_children)**Math.max(0,a.branch_levels-1)*Math.ceil(a.leaves_per_cluster*a.foliage_density);
  return a.leaf_size_m>0&&leaves>0&&leaves<=CANOPY_MORPH_MAX;
}:()=>false;

const NO_SEASON_TRAVEL={endSeasonTravel(){}};
export const makeSeasonTravel=FEAT_LITTER ? hub=>{
  if(!FEAT_DROP)return NO_SEASON_TRAVEL;
  const {gl,params,trans,faith}=hub;
  let s=null;
  const bounds=['pminx','pmaxx','pminy','pmaxy'];
  const read=()=>{const a=new Float32Array(faith.count*18);gl.bindBuffer(gl.ARRAY_BUFFER,faith.buf);gl.getBufferSubData(gl.ARRAY_BUFFER,0,a);return a;};
  function snapshot(p){
    hub.reseasonGrove(hub.grove,{...p,leaf_drop:0});
    const full=read(),data=full.slice(),S=hub.grove.season;
    hub.reseasonGrove(hub.grove,p);
    const retained=new Float32Array(S.n);
    for(let i=0;i<S.n;i++){
      const r=11*i,o=18*i,w=hub.hier.leafW?.[S.rec[r+6]*S.nLeaf+S.rec[r+7]]??1;
      retained[i]=w;data[o+17]*=w;for(let c=0;c<3;c++)data[o+8+c]*=w;
    }
    return {params:p,full,data,retained,bounds:bounds.map(k=>faith[k]),litter:(hub.grove.litter??[]).map(l=>({...l}))};
  }
  function beginSeasonTravel(to){
    const from={...params},aParams=from.litter>0?from:{...to},bParams=from.litter>0?{...to}:from;
    // A single uncompact record keeps the addresses of fallen leaves as well as the leaves still on their twigs.
    const previous=hub.hier;
    hub.installGrove(hub.buildGrove(previous,{keepSeason:true}));hub.hier.maxV=previous.maxV;
    const a=snapshot(aParams),b=snapshot(bParams),S=hub.grove.season,bothCarpets=aParams.litter>0&&bParams.litter>0;
    Object.assign(params,from);
    const byId=new Map(a.litter.map(l=>[l.j*S.nLeaf+l.k,l])),byB=new Map(b.litter.map(l=>[l.j*S.nLeaf+l.k,l])),carpet=[];
    const reflected=(state,l,i)=>{
      const o=i*18,fade=state.full[o+17],tau=l?.tau??[0,1,2].map(c=>fade?state.full[o+8+c]/fade:0);
      return litterAlbedo(tau,l?litterAge(state.params,l.D):0,state.params.leaf_wetness);
    };
    const paths=Array.from({length:S.n},(_,i)=>{
      const j=S.rec[i*11+6],k=S.rec[i*11+7],la=byId.get(j*S.nLeaf+k),lb=byB.get(j*S.nLeaf+k),l=la||lb?{...(la??lb)}:null;
      if(l)carpet.push(l);
      const landA=la?litterLanding(la,aParams):null,landB=lb?litterLanding(lb,bParams):null;
      return {l,la,lb,landA,landB,land:landA??landB,fade:l?.fade,clock:leafClock(aParams.seed,j,k),
        rgbA:bothCarpets&&l?reflected(a,la,i):null,rgbB:bothCarpets&&l?reflected(b,lb,i):null,rgb:bothCarpets&&l?[0,0,0]:null};
    });
    const data=a.full.slice(),journey=new Float32Array(S.n*4),layerData=S.base.map(a=>a.slice());
    gl.bindBuffer(gl.ARRAY_BUFFER,faith.buf);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);faith.count=S.n;
    for(let l=0;l<layerData.length;l++){
      gl.bindBuffer(gl.ARRAY_BUFFER,hub.layerVAO[l].buf);gl.bufferData(gl.ARRAY_BUFFER,layerData[l],gl.DYNAMIC_DRAW);hub.layerVAO[l].count=layerData[l].length/17;
    }
    const buf=gl.createBuffer();gl.bindVertexArray(faith.vao);gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,journey,gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(7);gl.vertexAttribPointer(7,4,gl.FLOAT,false,16,0);gl.vertexAttribDivisor(7,1);gl.bindVertexArray(null);
    const q=from.litter>0?0:1;
    s={a,b,S,paths,carpet,bothCarpets,data,journey,layerData,buf,start:q,end:1-q,q,side:q,pending:null,
      field:{tex:null,ox:0,oy:0,ext:1,weight:0},res:0,maxRes:Math.max(aParams.bake_resolution||aParams.tex_resolution,bParams.bake_resolution||bParams.tex_resolution),maxSamples:Math.max(aParams.sample_count,bParams.sample_count)};
    const cast={...hub,params:{...params},perf:{auto:false},src:{},srcDbgBuf:null,trans:{bloom:0},seasonCast:true,faithTex:null,faithScratch:null,
      faith:{...faith,gx:new Float32Array(faith.gx.length),gy:new Float32Array(faith.gy.length)},bakeRes:()=>s.res};
    cast.progFaith=hub.program(VS_SEASON_TRAVEL,FS_FAITH);cast.U={...hub.U,faith:hub.faithLocs(cast.progFaith)};
    cast.effCloud=()=>cast.params.cloud_thickness;
    Object.assign(cast,makeSource(cast));Object.assign(cast,makeBake(cast));s.cast=cast;
    trans.travelField=s.field;
  }
  function retargetSeasonTravel(to,opts){
    const same=p=>Object.keys(DEFAULTS).every(k=>k==='drift_phase'||k==='auto_quality'||k==='adaptive_motion'||p[k]===to[k]);
    const end=same(s.a.params)?0:same(s.b.params)?1:null;
    if(end===null){s.pending={to,opts};trans.onEnd=null;return;}
    const v=s.turn?s.turn.rate(trans.t):(s.end-s.start)/(trans.dur*trans.durScale);
    s.pending=null;s.start=s.q;s.end=end;trans.to=to;trans.t=0;
    trans.dur=Math.max(1e-3,opts.duration??trans.dur);trans.onEnd=opts.onEnd??null;
    s.turn=turnBack(s.q,v,end,2*trans.dur);trans.durScale=s.turn.T/trans.dur;
  }
  function stepSeasonTravel(_dt,t){
    s.q=s.turn?s.turn.at(t):lerp(s.start,s.end,t);
    const q=s.q,w=smoothstep(0,1,q),a=s.a,b=s.b,S=s.S,data=s.data,journey=s.journey;
    const side=q<.5?0:1,native=side===0?a:b;
    if(side!==s.side){
      s.side=side;params.sample_count=native.params.sample_count;params.bake_resolution=native.params.bake_resolution;hub.applyQuality();
    }
    Object.assign(params,seasonCamera(a.params,b.params,w));
    if(!params.drift_auto)params.drift_phase=lerpAngle(a.params.drift_phase,b.params.drift_phase,w,TAU);
    // Use journey progress for the live look too: reversing must retain the displayed soil, weather and wetness.
    for(const k of LOOK_KEYS)params[k]=lerp(a.params[k],b.params[k],w);
    // A lone carpet keeps its authored age; two carpets carry their own endpoint reflectances below.
    params.litter=s.bothCarpets?1:q===1?0:a.params.litter;
    params.phenology=s.bothCarpets?lerp(a.params.phenology,b.params.phenology,w):a.params.phenology;
    params.litter_age=s.bothCarpets?lerp(a.params.litter_age,b.params.litter_age,w):a.params.litter_age;
    const bulk=hub.bulkShift();
    for(let i=0;i<S.n;i++){
      const path=s.paths[i],o=18*i,r=11*i,f=flightProgress(q,path.clock),colour=smoothstep(0,1,(q-.12*path.clock)/.88);
      const v=path.la&&path.lb?0:path.la?f:path.lb?1-f:1;
      if(path.la&&path.lb)path.land={x:lerp(path.landA.x,path.landB.x,f),y:lerp(path.landA.y,path.landB.y,f),rot:lerpAngle(path.landA.rot,path.landB.rot,f,TAU)};
      const cov=a.full[o+17]*(path.l?1:lerp(a.retained[i],b.retained[i],w));data[o+17]=cov;
      for(let c=0;c<3;c++)data[o+8+c]=lerp(a.full[o+8+c],b.full[o+8+c],colour)*(a.full[o+17]?cov/a.full[o+17]:0);
      journey[i*4]=path.land?.x??data[o];journey[i*4+1]=path.land?.y??data[o+1];journey[i*4+2]=path.land?-path.land.rot:data[o+4];journey[i*4+3]=v;
      const layer=S.rec[r+9],at=S.rec[r+10],coverage=path.l?smoothstep(0,.13,v):1;
      for(let c=0;c<3;c++)s.layerData[layer][at+8+c]=data[o+8+c]*coverage;
      s.layerData[layer][at+16]=cov*coverage;
      if(path.l){
        path.l.fade=path.fade*(1-smoothstep(0,.18,v));
        if(s.bothCarpets){
          path.l.D=lerp(path.la?.D??path.lb.D,path.lb?.D??path.la.D,w);
          for(let c=0;c<3;c++)path.rgb[c]=lerp(path.rgbA[c],path.rgbB[c],colour);
        }
        const curl=.22*Math.sin(Math.PI*v),phi=data[o+7]+2*v,height=data[o+16]*v;
        const x=lerp(path.land.x,data[o],v)+curl*Math.cos(phi),y=lerp(path.land.y,data[o+1],v)+curl*Math.sin(phi);
        // The mark turns with its shadow: VS_SEASON_TRAVEL's short arc and tumble, in the carpet's counter-clockwise sense.
        const turn=lerpAngle(-path.land.rot,data[o+4],v,TAU)+.2*Math.sin(TAU*v+data[o+7])*Math.sin(Math.PI*v);
        path.l.flight={x:x-bulk[0]*height,y:y-bulk[1]*height,rot:-turn,albedo:path.rgb};
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER,faith.buf);gl.bufferSubData(gl.ARRAY_BUFFER,0,data);
    gl.bindBuffer(gl.ARRAY_BUFFER,s.buf);gl.bufferSubData(gl.ARRAY_BUFFER,0,journey);
    for(let l=0;l<s.layerData.length;l++){gl.bindBuffer(gl.ARRAY_BUFFER,hub.layerVAO[l].buf);gl.bufferSubData(gl.ARRAY_BUFFER,0,s.layerData[l]);}
    hub.grove.litter=s.carpet;hub.litter.grove=null;hub.regenSource();
    const f=s.field;f.weight=smoothstep(0,.1,q)*smoothstep(0,.1,1-q);
    if(f.weight>0){
      const cast=s.cast,res=hub.bakeRes(s.maxRes);
      if(s.res!==res){
        if(cast.faithTex)gl.deleteTexture(cast.faithTex);if(cast.faithScratch)gl.deleteTexture(cast.faithScratch);
        s.res=res;cast.faithTex=hub.makeLayerTexture(res);cast.faithScratch=hub.makeLayerTexture(res);
      }
      Object.assign(cast.params,params,{sample_count:hub.perf.auto?hub.faithfulSamples(s.maxSamples):s.maxSamples});
      bounds.forEach((k,i)=>{cast.faith[k]=lerp(a.bounds[i],b.bounds[i],w);});
      cast.regenSource();cast.bakeFaithful();
      Object.assign(f,{tex:cast.faithTex,ox:cast.faith.ox,oy:cast.faith.oy,ext:cast.faith.ext});
    }
    if(hub.fillWanted())hub.bakeFill(true);
  }
  function drawSeasonTravel(){
    if(s.field.weight<1){
      const native=s.side===0?s.a:s.b,diffuse=params.leaf_diffuse;
      gl.bindBuffer(gl.ARRAY_BUFFER,faith.buf);gl.bufferSubData(gl.ARRAY_BUFFER,0,native.data);
      bounds.forEach((k,i)=>{faith[k]=native.bounds[i];});params.leaf_diffuse=native.params.leaf_diffuse;
      hub.bakeFaithful();params.leaf_diffuse=diffuse;
      gl.bindBuffer(gl.ARRAY_BUFFER,faith.buf);gl.bufferSubData(gl.ARRAY_BUFFER,0,s.data);
    }
    hub.drawFrameInto(null,hub.canvas.width,hub.canvas.height);
  }
  function finishSeasonTravel(){
    const maxV=hub.hier.maxV;
    hub.regenCanopy();hub.hier.maxV=maxV;
    return s.pending;
  }
  function endSeasonTravel(){
    if(!s)return;
    const pending=s.pending;
    gl.deleteBuffer(s.buf);
    gl.deleteProgram(s.cast.progFaith);
    if(s.res){gl.deleteTexture(s.cast.faithTex);gl.deleteTexture(s.cast.faithScratch);}
    s=null;trans.travelField=null;
    return pending;
  }
  return {beginSeasonTravel,retargetSeasonTravel,stepSeasonTravel,drawSeasonTravel,finishSeasonTravel,endSeasonTravel};
}:()=>NO_SEASON_TRAVEL;
