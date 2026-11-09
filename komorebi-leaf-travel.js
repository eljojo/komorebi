import { ballisticK, lerp, lerpAngle, smoothstep, TAU } from './komorebi-math.js';
import { DEFAULTS, MORPH_KEYS } from './komorebi-params.js';
import { VS_LEAF_TRAVEL, FS_LEAF_TRAVEL } from './komorebi-shaders.js';
const FEAT_LEAF_DIFFUSE = true;

// Match neighbourhoods before individual leaves: different RNG indices do not name the same branch.
export function pairLeaves(a,b){
  function groups(q){
    const g=Array.from({length:q.hier.nClusterTotal},()=>[]);
    for(let i=0;i<q.leaves.length;i+=18)g[Math.round(q.leaves[i+11])].push(i);
    return g;
  }
  function spatial(ids,h,depth=0){
    if(ids.length<2)return ids;
    const axis=depth%2,m=ids.length>>1;
    ids.sort((i,j)=>h.clusterPlan[2*i+axis]-h.clusterPlan[2*j+axis]||i-j);
    return spatial(ids.slice(0,m),h,depth+1).concat(spatial(ids.slice(m),h,depth+1));
  }
  function each(aa,bb,fn){
    const n=Math.max(aa.length,bb.length),na=aa.length,nb=bb.length;
    if(!na||!nb)return;
    for(let i=0;i<n;i++){
      const ia=Math.min(na-1,Math.floor((i+.5)*na/n)),ib=Math.min(nb-1,Math.floor((i+.5)*nb/n));
      fn(aa[ia],bb[ib],i===Math.min(n-1,Math.floor((ia+.5)*n/na)),i===Math.min(n-1,Math.floor((ib+.5)*n/nb)));
    }
  }
  const ga=groups(a),gb=groups(b),pairs=[];
  each(spatial(ga.map((_,i)=>i).filter(i=>ga[i].length),a.hier),spatial(gb.map((_,i)=>i).filter(i=>gb[i].length),b.hier),
    (ca,cb,la,lb)=>each(ga[ca],gb[cb],(ia,ib,liveA,liveB)=>pairs.push([ia,ib,la&&liveA,lb&&liveB])));
  return pairs;
}

// Evaluate the native wind joints before interpolation; a leaf keeps moving while its destination changes.
function moved(q,i,out){
  const d=q.leaves,j=Math.round(d[i+11]),p=q.params,m=q.motion,H=q.hier,G=H.clusterGeom,D=H.clusterData,o=4*j;
  const L=D[o],T=D[o+1],cl=Math.cos(L),sl=Math.sin(L),ct=Math.cos(T),st=Math.sin(T);
  let tx=G[o],ty=G[o+1];const px=G[o+2],py=G[o+3];
  if(!p.faithful_canopy){
    const dx=tx-px,dy=ty-py,r=Math.max(Math.hypot(dx,dy),.001),sa=D[o+2]*.6,cs=Math.cos(sa),sn=Math.sin(sa),len=Math.min(p.stem_length,r*.9);
    tx-=len*(cs*dx+sn*dy)/r;ty-=len*(-sn*dx+cs*dy)/r;
  }
  const dx=d[i]-tx,dy=d[i+1]-ty,xx=tx+ct*dx-st*dy,yy=ty+st*dx+ct*dy;
  const sw=p.leaf_swing*d[i+6]*(.5*m.u+Math.abs(m.u)*Math.sin(m.time*p.flutter_freq*6.2831853+d[i+7]));
  const z=p.faithful_canopy ? D[o+2]+d[i+16]*D[o+3] : p.canopy_base_height_m+H.twigs[j].layer/Math.max(1,p.layer_count-1)*p.canopy_thickness_m;
  const gain=p.faithful_canopy ? z/Math.max(q.hMax,.001) : 1+p.sway_height_gain*(z/p.canopy_base_height_m-1);
  const phase=p.drift_phase+d[i+15],ox=d[i+12]*Math.cos(phase),oy=d[i+13]*Math.sin(phase),co=Math.cos(d[i+14]),so=Math.sin(d[i+14]);
  out[0]=px+cl*(xx-px)-sl*(yy-py)+m.sway[0]*gain+p.drift_amount*(co*ox+so*oy);
  out[1]=py+sl*(xx-px)+cl*(yy-py)+m.sway[1]*gain+p.drift_amount*(-so*ox+co*oy);
  out[2]=d[i+2];out[3]=d[i+3]*Math.max(.05,Math.abs(Math.cos(d[i+5]+sw)));out[4]=d[i+4]-L-T+.2*sw;out[5]=z;
}
const aa=new Float64Array(6),bb=new Float64Array(6);
export function moveLeaves(a,b,pairs,w,out){
  for(let n=0;n<pairs.length;n++){
    const [ia,ib,la,lb]=pairs[n],o=12*n;
    moved(a,ia,aa);moved(b,ib,bb);
    out[o]=lerp(aa[0],bb[0],w);out[o+1]=lerp(aa[1],bb[1],w);
    const area=lerp(la?aa[2]*aa[3]:0,lb?bb[2]*bb[3]:0,w);
    const aspect=Math.exp(lerp(Math.log(aa[2]/aa[3]),Math.log(bb[2]/bb[3]),w));
    out[o+2]=Math.sqrt(area*aspect);out[o+3]=Math.sqrt(area/aspect);out[o+4]=lerpAngle(aa[4],bb[4],w,TAU);
    for(let c=0;c<3;c++)out[o+5+c]=lerp(a.leaves[ia+8+c],b.leaves[ib+8+c],w);
    out[o+8]=lerp(aa[5],bb[5],w);out[o+9]=lerp(a.leaves[ia+17],b.leaves[ib+17],w);
    out[o+10]=(Math.floor((a.leaves[ia+11]%1)*(a.shape?.idFrac??32)+.5)+.5)/(a.shape?.rows??8);
    out[o+11]=(Math.floor((b.leaves[ib+11]%1)*(b.shape?.idFrac??32)+.5)+.5)/(b.shape?.rows??8);
  }
  return out;
}

export function makeLeafTravel(hub,createScene){
  const {gl,params,trans}=hub;
  let s=null;
  const read=h=>{
    const leaves=new Float32Array(h.faith.count*18);
    gl.bindBuffer(gl.ARRAY_BUFFER,h.faith.buf);gl.getBufferSubData(gl.ARRAY_BUFFER,0,leaves);
    return {leaves,hier:h.hier,params:h.params,motion:h.motion,hMax:h.faith.hMax,shape:h.grove.shape,texture:h.grove.leafTex};
  };
  function beginLeafTravel(to){
    const from=createScene();
    s={from,a:read(from.hub),b:null,start:0,end:1,progress:0,lookA:{...params},lookB:{...to},pending:null,
      field:{tex:null,ox:0,oy:0,ext:1,weight:0},toneStart:[0,0,0],toneEnd:[0,0,0]};
    s.toneStart[params.tone_map]=1;s.toneEnd[to.tone_map]=1;
  }
  function retargetLeafTravel(to,opts){
    // Reversing the same journey keeps its carriers and both wind states. Other requests wait for its settled frame.
    const same=p=>Object.keys(DEFAULTS).every(k=>k==='drift_phase'||k==='auto_quality'||k==='adaptive_motion'||p[k]===to[k]);
    const end=same(s.lookA)?0:same(s.lookB)?1:null;
    if(end===null){s.pending={to,opts};trans.onEnd=null;return false;}
    s.pending=null;s.start=s.progress;s.end=end;
    s.toneStart=[...(trans.travelTone??s.toneStart)];s.toneEnd=[0,0,0];s.toneEnd[to.tone_map]=1;
    return true;
  }
  function init(){
    s.b=read(hub);s.pairs=pairLeaves(s.a,s.b);s.data=new Float32Array(s.pairs.length*12);
    s.prog=hub.program(VS_LEAF_TRAVEL,FS_LEAF_TRAVEL);
    s.u=Object.fromEntries(['Origin','Extent','G','Box','LeafA','LeafB','ShapeA','ShapeB','Weight','Edge','BeamK','EdgeArea'].map(k=>[k,gl.getUniformLocation(s.prog,`u${k}`)]));
    s.buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,s.buf);gl.bufferData(gl.ARRAY_BUFFER,s.data,gl.DYNAMIC_DRAW);
    s.vao=gl.createVertexArray();gl.bindVertexArray(s.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER,hub.quadBuf);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,s.buf);
    for(let i=1;i<=3;i++){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,4,gl.FLOAT,false,48,(i-1)*16);gl.vertexAttribDivisor(i,1);}
    s.textures=[gl.createTexture(),gl.createTexture()];s.fbos=[gl.createFramebuffer(),gl.createFramebuffer()];s.res=0;
    const boxes=[s.a.shape?.box??[0,0,1,1],s.b.shape?.box??[0,0,1,1]];
    const x0=Math.min(...boxes.map(b=>b[0]-b[2])),x1=Math.max(...boxes.map(b=>b[0]+b[2]));
    const y0=Math.min(...boxes.map(b=>b[1]-b[3])),y1=Math.max(...boxes.map(b=>b[1]+b[3]));
    s.box=[(x0+x1)/2,(y0+y1)/2,(x1-x0)/2,(y1-y0)/2];
  }
  function stepLeafTravel(dt,e){
    if(!s.b)init();
    const from=s.from.hub,phase=from.params.drift_phase;
    for(const k of MORPH_KEYS)from.params[k]=params[k];
    from.params.drift_phase=phase;
    if(from.motionActive())from.motionTick(dt);
    s.progress=lerp(s.start,s.end,e);
    trans.travelTone=s.toneStart.map((v,i)=>lerp(v,s.toneEnd[i],e));
    const f=s.field,w=s.progress;
    f.weight=smoothstep(0,.12,w)*smoothstep(0,.12,1-w);
    trans.travelField=f;
    if(f.weight===0)return;
    const data=moveLeaves(s.a,s.b,s.pairs,w,s.data);
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity,h0=Infinity,h1=-Infinity,pad=.1;
    for(let i=0;i<data.length;i+=12){x0=Math.min(x0,data[i]);x1=Math.max(x1,data[i]);y0=Math.min(y0,data[i+1]);y1=Math.max(y1,data[i+1]);h0=Math.min(h0,data[i+8]);h1=Math.max(h1,data[i+8]);pad=Math.max(pad,Math.max(data[i+2],data[i+3])*3);}
    const proj=hub.projMatrix();
    let gx0=Infinity,gy0=Infinity,gx1=-Infinity,gy1=-Infinity;
    for(let i=0;i<hub.src.count;i++){
      const x=hub.src.flat[3*i],y=hub.src.flat[3*i+1],gx=proj[0]*x+proj[2]*y,gy=proj[1]*x+proj[3]*y;
      gx0=Math.min(gx0,gx);gx1=Math.max(gx1,gx);gy0=Math.min(gy0,gy);gy1=Math.max(gy1,gy);
    }
    // The atlas contains the sun-projected leaves, including every halo sample, rather than just their plan positions.
    x0-=Math.max(gx0*h0,gx0*h1,gx1*h0,gx1*h1);x1-=Math.min(gx0*h0,gx0*h1,gx1*h0,gx1*h1);
    y0-=Math.max(gy0*h0,gy0*h1,gy1*h0,gy1*h1);y1-=Math.min(gy0*h0,gy0*h1,gy1*h0,gy1*h1);
    f.ext=Math.max(x1-x0,y1-y0)+2*pad;f.ox=(x0+x1-f.ext)/2;f.oy=(y0+y1-f.ext)/2;
    const res=hub.bakeRes();
    if(s.res!==res){
      for(let i=0;i<2;i++){
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,s.textures[i]);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,res,res,0,gl.RGBA,gl.HALF_FLOAT,null);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER,s.fbos[i]);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,s.textures[i],0);
      }
      s.res=res;
    }
    f.tex=s.textures[0];gl.bindBuffer(gl.ARRAY_BUFFER,s.buf);gl.bufferSubData(gl.ARRAY_BUFFER,0,data);
    gl.viewport(0,0,res,res);gl.bindFramebuffer(gl.FRAMEBUFFER,s.fbos[0]);gl.disable(gl.BLEND);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    const u=s.u;
    for(let i=0;i<hub.src.count;i++){
      gl.bindFramebuffer(gl.FRAMEBUFFER,s.fbos[1]);gl.disable(gl.BLEND);gl.clearColor(1,1,1,1);gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(s.prog);gl.bindVertexArray(s.vao);gl.enable(gl.BLEND);gl.blendFunc(gl.ZERO,gl.SRC_COLOR);
      gl.uniform2f(u.Origin,f.ox,f.oy);gl.uniform2f(u.Extent,f.ext,f.ext);gl.uniform4fv(u.Box,s.box);
      const sx=hub.src.flat[3*i],sy=hub.src.flat[3*i+1];gl.uniform2f(u.G,proj[0]*sx+proj[2]*sy,proj[1]*sx+proj[3]*sy);
      gl.uniform1f(u.Weight,w);gl.uniform1f(u.Edge,lerp(s.lookA.edge_softness,s.lookB.edge_softness,w));
      gl.uniform1f(u.BeamK,FEAT_LEAF_DIFFUSE?ballisticK(params.leaf_diffuse):0);gl.uniform1i(u.EdgeArea,FEAT_LEAF_DIFFUSE&&params.edge_area?1:0);
      for(const [unit,q] of [[0,s.a],[1,s.b]]){
        gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,q.texture??hub.layerTex[3]);
        gl.uniform1i(unit===0?u.LeafA:u.LeafB,unit);gl.uniform1i(unit===0?u.ShapeA:u.ShapeB,q.shape?1:0);
      }
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,s.pairs.length);
      gl.bindFramebuffer(gl.FRAMEBUFFER,s.fbos[0]);gl.blendFunc(gl.ONE,gl.ONE);gl.useProgram(hub.progFAcc);gl.bindVertexArray(hub.emptyVAO);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,s.textures[1]);gl.uniform1i(hub.U.facc.tex,0);gl.uniform1f(hub.U.facc.weight,hub.src.flat[3*i+2]);gl.drawArrays(gl.TRIANGLES,0,3);
    }
    gl.disable(gl.BLEND);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  }
  function drawLeafTravel(){
    const outgoing=s.progress<.5,h=outgoing?s.from.hub:hub;
    if(outgoing)Object.assign(h.trans,{active:true,irisRadius:trans.irisRadius,travelField:s.field,travelTone:trans.travelTone});
    const diffuse=h.params.leaf_diffuse;
    // Zero selects a different native texel law. Let the moving cast carry that change, rather than snapping it at landing.
    h.params.leaf_diffuse=(outgoing?s.lookA:s.lookB).leaf_diffuse;
    h.regenSource();
    // The native share must contain this frame's wind, even while the moving cast hides most of it.
    if(s.field.weight<1)h.bake();
    h.drawFrameInto(null,hub.canvas.width,hub.canvas.height);
    h.params.leaf_diffuse=diffuse;
  }
  function finishLeafTravel(){
    if(s.end===0)s.from.restore();
    return s.pending;
  }
  function endLeafTravel(){
    if(!s)return;
    const pending=s.pending;
    s.from.dispose();
    if(s.prog)gl.deleteProgram(s.prog);
    if(s.vao)gl.deleteVertexArray(s.vao);if(s.buf)gl.deleteBuffer(s.buf);
    s.textures?.forEach(t=>{gl.deleteTexture(t);});s.fbos?.forEach(f=>{gl.deleteFramebuffer(f);});
    s=null;trans.travelField=null;trans.travelTone=null;
    return pending;
  }
  return {beginLeafTravel,retargetLeafTravel,stepLeafTravel,drawLeafTravel,finishLeafTravel,endLeafTravel};
}
