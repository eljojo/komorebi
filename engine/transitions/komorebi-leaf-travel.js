import { clamp, lerp, lerpAngle, smoothstep, TAU } from '../komorebi-math.js';
import { turnBack } from './komorebi-routes.js';
import { ballisticK } from '../leaf/komorebi-leaf.js';
import { flutterLevel, depthGate } from '../motion/komorebi-air.js';
import { CANOPY_MORPH_MAX, DEFAULTS, MORPH_KEYS } from '../komorebi-params.js';
import { leafLayerOf } from '../canopy/komorebi-grove.js';
import { VS_LEAF_TRAVEL, FS_LEAF_TRAVEL, VS_LEAF_TRAVEL_PATCH, FS_LEAF_TRAVEL_PATCH, FS_LEAF_PROGRESS, FS_PROGRESS_BLUR, FS_PATCH_MIX, VS_FULL,
  VS_LEAF_CARRY, VS_LEAF_CARRY_PATCH, FS_LEAF_CARRY, LEAF_CARRY_OUT, LEAF_CARRY_PATCH_OUT } from '../transport/komorebi-shaders.js';
const FEAT_LEAF_DIFFUSE = true;

// BETWEEN TWO FAITHFUL GROVES THE TRAVEL GOES PATCH BY PATCH (authored, not physics). A carrier's place in a
// spatially coherent field over the floor sets when it makes its own trip, and carriers pair within small floor
// cells, so mid-route some patches still show the outgoing grove (its leaves and its gaps) and others the incoming
// one, each lit and graded as its own look. The route between the faithful and the layer cast of one scene keeps
// the single progress and the cluster pairing.
const PATCH_M = .4;            // the patches' size (m): the field's spatial period; pairing cells are half of it, the colour map's blur a third
const TRIP_D = .35;            // the share of the middle one carrier's trip takes; the starts spread over the rest
const TRAVEL_HANDOFF = .12;    // the progress over which each native cast hands over to the moving one, at both ends
export { PATCH_M, TRIP_D };
export const patchTravel = (from, to) => !!from.faithful_canopy && !!to.faithful_canopy;
// The route's progress inside the moving cast's full-weight middle: every carrier is at 0 through the first
// handoff and at 1 through the last, so each native cast meets its own grove.
export const tripW = w => clamp((w - TRAVEL_HANDOFF)/(1 - 2*TRAVEL_HANDOFF), 0, 1);
// One carrier's own progress: its trip starts at p(1-d) of the middle and takes d of it.
export const tripClock = (p, W) => smoothstep(p*(1 - TRIP_D), p*(1 - TRIP_D) + TRIP_D, W);
// The grade each of the two pictures carries from its own look; geometry, sun, wind, leaf diffusion and the mask stay shared.
const GRADE_KEYS = ['exposure','cloud_exposure','contrast','ambient_skylight','sky_turbidity','mesopic_strength','chromatic_aberration',
  'ground_r','ground_g','ground_b','sky_scatter','fill_scatter','sun_cosine','sun_extinction'];
const PROGRESS_RES = 128;   // the colour map's texels across the moving cast's frame
const hash1 = n => { const x = Math.sin(n*127.1 + 311.7)*43758.5453; return x - Math.floor(x); };
const hash2 = (i, j) => { const x = Math.sin(i*127.1 + j*311.7)*43758.5453; return x - Math.floor(x); };
function valueNoise(x, y){
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, sx = fx*fx*(3 - 2*fx), sy = fy*fy*(3 - 2*fy);
  return lerp(lerp(hash2(i, j), hash2(i + 1, j), sx), lerp(hash2(i, j + 1), hash2(i + 1, j + 1), sx), sy);
}
// Each point's place in the patch field (xy: x0,y0,x1,y1...): two octaves of value noise at `patch` and a little
// per-point jitter, ranked to an even spread over [0,1] so the starts are evenly timed. A per-leaf random value would
// average to a uniform blend under the colour map's blur.
export function patchField(xy, patch){
  const n = xy.length >> 1, v = new Float64Array(n);
  for(let k = 0; k < n; k++){
    const x = xy[2*k]/patch, y = xy[2*k + 1]/patch;
    v[k] = .7*valueNoise(x, y) + .3*valueNoise(2.03*x + 17.1, 2.03*y - 5.3) + .12*(hash1(k) - .5);
  }
  const order = [...v.keys()].sort((a, b) => v[a] - v[b] || a - b), p = new Float32Array(n);
  order.forEach((k, r) => { p[k] = n > 1 ? r/(n - 1) : 0; });
  return p;
}

// Pair two ordered lists rank by rank: every entry of each occurs exactly once live; the longer list's surplus
// shares a partner, with the shorter side's copy not live (it contracts to zero, or grows from it).
function each(aa,bb,fn){
  const n=Math.max(aa.length,bb.length),na=aa.length,nb=bb.length;
  if(!na||!nb)return;
  for(let i=0;i<n;i++){
    const ia=Math.min(na-1,Math.floor((i+.5)*na/n)),ib=Math.min(nb-1,Math.floor((i+.5)*nb/n));
    fn(aa[ia],bb[ib],i===Math.min(n-1,Math.floor((ia+.5)*n/na)),i===Math.min(n-1,Math.floor((ib+.5)*n/nb)));
  }
}

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
  const ga=groups(a),gb=groups(b),pairs=[];
  each(spatial(ga.map((_,i)=>i).filter(i=>ga[i].length),a.hier),spatial(gb.map((_,i)=>i).filter(i=>gb[i].length),b.hier),
    (ca,cb,la,lb)=>each(ga[ca],gb[cb],(ia,ib,liveA,liveB)=>pairs.push([ia,ib,la&&liveA,lb&&liveB])));
  return pairs;
}

// Evaluate the native wind joints before interpolation; a leaf keeps moving while its destination changes. A leaf hung on older wood
// (inner_leaves) is drawn as the bake draws it: faithful, it drops its twig's bend by its pivot weight (VS_FAITH's PIVOT); layered,
// it is cast from the layer of its own height, as the hang loop binned it. A leaf at its twig's height keeps the twig's layer.
function moved(q,i,out){
  const d=q.leaves,j=Math.round(d[i+11]),p=q.params,m=q.motion,H=q.hier,G=H.clusterGeom,D=H.clusterData,o=4*j;
  const L=D[o],T=p.faithful_canopy&&q.pivot ? D[o+1]*(1-q.pivot[i/18]) : D[o+1],cl=Math.cos(L),sl=Math.sin(L),ct=Math.cos(T),st=Math.sin(T);
  let tx=G[o],ty=G[o+1];const px=G[o+2],py=G[o+3];
  if(!p.faithful_canopy){
    const dx=tx-px,dy=ty-py,r=Math.max(Math.hypot(dx,dy),.001),sa=D[o+2]*.6,cs=Math.cos(sa),sn=Math.sin(sa),len=Math.min(p.stem_length,r*.9);
    tx-=len*(cs*dx+sn*dy)/r;ty-=len*(-sn*dx+cs*dy)/r;
  }
  const dx=d[i]-tx,dy=d[i+1]-ty,xx=tx+ct*dx-st*dy,yy=ty+st*dx+ct*dy;
  const S=H.swayData,u=S?m.u+S[o+2]:m.u;   // its tree's trunk: tree 0's plus what its own adds (row 2, as the shaders read it)
  const wm=flutterLevel(u,H.airData?.[o]||0,p.wind_air), sw=p.leaf_swing*d[i+6]*(.5*u+wm*Math.sin(m.time*p.flutter_freq*6.2831853+d[i+7]))*depthGate(wm,H.airData?.[o+1]||0,p.wind_depth);
  const z=p.faithful_canopy ? D[o+2]+d[i+16]*D[o+3] : p.canopy_base_height_m+leafLayerOf(H,j,d[i+16])/Math.max(1,p.layer_count-1)*p.canopy_thickness_m;
  const gain=p.faithful_canopy ? z/Math.max(q.hMax,.001) : 1+p.sway_height_gain*(z/p.canopy_base_height_m-1);
  const phase=p.drift_phase+d[i+15],ox=d[i+12]*Math.cos(phase),oy=d[i+13]*Math.sin(phase),co=Math.cos(d[i+14]),so=Math.sin(d[i+14]);
  const swx=S?m.sway[0]+S[o]:m.sway[0],swy=S?m.sway[1]+S[o+1]:m.sway[1];
  out[0]=px+cl*(xx-px)-sl*(yy-py)+swx*gain+p.drift_amount*(co*ox+so*oy);
  out[1]=py+sl*(xx-px)+cl*(yy-py)+swy*gain+p.drift_amount*(-so*ox+co*oy);
  out[2]=d[i+2];out[3]=d[i+3]*Math.max(.05,Math.abs(Math.cos(d[i+5]+sw)));out[4]=d[i+4]-L-T+.2*sw;out[5]=z;
}
// Patch by patch the correspondence respects the floor. Every endpoint leaf's cast point (plan point - g*h, at the
// mean sun throw g per metre of height) falls in a square cell of side `cell`; a cell whose leaves have no partner on
// the other side hands them to the nearest cell (by index) that has some. Within a cell both sides are ordered by
// alternating axes and paired rank by rank, so a trip is a few centimetres and a cell's surplus contracts or grows.
export function patchPairs(a,b,g,cell){
  const out=new Float64Array(6),cast=q=>{const c=[];for(let i=0;i<q.leaves.length;i+=18){moved(q,i,out);c.push([i,out[0]-g[0]*out[5],out[1]-g[1]*out[5]]);}return c;};
  const ca=cast(a),cb=cast(b);
  if(!ca.length||!cb.length)return [];
  const cells=new Map(),bin=(list,side)=>{
    for(const l of list){
      const i=Math.floor(l[1]/cell),j=Math.floor(l[2]/cell),k=`${i},${j}`;
      if(!cells.has(k))cells.set(k,{i,j,s:[[],[]]});
      cells.get(k).s[side].push(l);
    }
  };
  bin(ca,0);bin(cb,1);
  const keys=[...cells.keys()].sort((p,q)=>{const P=cells.get(p),Q=cells.get(q);return P.i-Q.i||P.j-Q.j;});
  const full=keys.filter(k=>cells.get(k).s[0].length&&cells.get(k).s[1].length);
  for(const side of [0,1]){
    // With no cell holding both sides, an orphan goes to the nearest cell holding the other side.
    const homes=full.length?full:keys.filter(k=>cells.get(k).s[1-side].length);
    for(const k of keys){
      const c=cells.get(k);
      if(!c.s[side].length||c.s[1-side].length)continue;
      let best=null,bd=Infinity;
      for(const h of homes){const H=cells.get(h),d=(H.i-c.i)**2+(H.j-c.j)**2;if(d<bd){bd=d;best=H;}}
      best.s[side].push(...c.s[side]);c.s[side]=[];
    }
  }
  function kd(l,depth=0){
    if(l.length<2)return l;
    const axis=1+depth%2,m=l.length>>1;l.sort((p,q)=>p[axis]-q[axis]||p[0]-q[0]);
    return kd(l.slice(0,m),depth+1).concat(kd(l.slice(m),depth+1));
  }
  const pairs=[];
  for(const k of keys){const [la,lb]=cells.get(k).s;each(kd(la),kd(lb),(p,q,liveA,liveB)=>pairs.push([p[0],q[0],liveA,liveB]));}
  return pairs;
}

const aa=new Float64Array(6),bb=new Float64Array(6);
export function moveLeaves(a,b,pairs,w,out){
  for(let n=0;n<pairs.length;n++)carry(a,b,pairs[n],w,out,12*n);
  return out;
}
// Patch by patch every carrier is at its own progress wi[n], under the same laws as moveLeaves; slots 12 and 13 carry
// the outline mix and the edge softness at that progress, which the patch shader reads per carrier.
const STRIDE_PATCH=16;
export function movePatchLeaves(a,b,pairs,wi,edge,out){
  for(let n=0;n<pairs.length;n++){
    const o=STRIDE_PATCH*n,w=wi[n];
    carry(a,b,pairs[n],w,out,o);
    out[o+12]=w;out[o+13]=lerp(edge[0],edge[1],w);out[o+14]=0;out[o+15]=0;
  }
  return out;
}
// Varied tables encode a blend between two outlines; rounding it would change the blade during the native handoff.
function travelRow(q,i){
  const variant=(q.leaves[i+11]%1)*(q.shape?.idFrac??32);
  return (q.shape?.idFrac>64?variant:Math.floor(variant+.5)+.5)/(q.shape?.rows??8);
}
function carry(a,b,pair,w,out,o){
  const [ia,ib,la,lb]=pair;
  moved(a,ia,aa);moved(b,ib,bb);
  out[o]=lerp(aa[0],bb[0],w);out[o+1]=lerp(aa[1],bb[1],w);
  const area=lerp(la?aa[2]*aa[3]:0,lb?bb[2]*bb[3]:0,w);
  const aspect=Math.exp(lerp(Math.log(aa[2]/aa[3]),Math.log(bb[2]/bb[3]),w));
  out[o+2]=Math.sqrt(area*aspect);out[o+3]=Math.sqrt(area/aspect);out[o+4]=lerpAngle(aa[4],bb[4],w,TAU);
  for(let c=0;c<3;c++)out[o+5+c]=lerp(a.leaves[ia+8+c],b.leaves[ib+8+c],w);
  out[o+8]=lerp(aa[5],bb[5],w);out[o+9]=lerp(a.leaves[ia+17],b.leaves[ib+17],w);
  out[o+10]=travelRow(a,ia);out[o+11]=travelRow(b,ib);
}

// THE CARRIERS ON THE GPU. moveLeaves and movePatchLeaves above are the reference; VS_LEAF_CARRY runs the same laws once per carrier a
// frame, writing what they write into the buffer the stamp draws from, so the route keeps on the CPU only what does not move: each end's
// leaf as five vec4 (its faithful record, the height slot holding a layered end's layer fraction, then its fade, pivot weight and outline
// row) and the pair's (live at A, live at B, place in the patch field, 0).
export const CARRY_STRIDE=44;
function carryEnd(q,i,out,o){
  const d=q.leaves,p=q.params;
  for(let k=0;k<16;k++)out[o+k]=d[i+k];
  out[o+16]=p.faithful_canopy ? d[i+16] : leafLayerOf(q.hier,Math.round(d[i+11]),d[i+16])/Math.max(1,p.layer_count-1);
  out[o+17]=d[i+17];out[o+18]=p.faithful_canopy&&q.pivot ? q.pivot[i/18] : 0;out[o+19]=travelRow(q,i);
}
export function carrierRecords(a,b,pairs,trip,out=new Float32Array(pairs.length*CARRY_STRIDE)){
  for(let n=0;n<pairs.length;n++){
    const [ia,ib,la,lb]=pairs[n],o=CARRY_STRIDE*n;
    carryEnd(a,ia,out,o);carryEnd(b,ib,out,o+20);
    out[o+40]=la?1:0;out[o+41]=lb?1:0;out[o+42]=trip?trip[n]:0;out[o+43]=0;
  }
  return out;
}
// THE MOVING CAST'S FRAME. The carriers are moved on the GPU, but the map they are cast into is framed on the CPU, before the pass. A
// carrier's plan point needs no flutter (it turns and foreshortens a leaf about its centre, moving no centre), so each end's leaves are
// placed as moved() places them less their drift: one turn per clump (its twig's and its limb's, about their joints), a leaf on older
// wood's own smaller twig turn, its tree's sway at its height. The drift is bounded instead, by its largest orbit; the carriers are then
// lerped at their progress and boxed. No trig per leaf but the leaves on older wood, so a frame of the busiest route costs a fraction of
// a millisecond where moving the carriers cost several.
export function framePrep(q){
  const d=q.leaves,n=d.length/18,p=q.params,faithful=p.faithful_canopy,hgt=new Float32Array(n),piv=new Float32Array(n);
  let reach=0,size=0;
  for(let k=0,i=0;k<n;k++,i+=18){
    hgt[k]=faithful ? d[i+16] : leafLayerOf(q.hier,Math.round(d[i+11]),d[i+16])/Math.max(1,p.layer_count-1);
    piv[k]=faithful&&q.pivot ? q.pivot[k] : 0;
    reach=Math.max(reach,Math.hypot(d[i+12],d[i+13]));size=Math.max(size,d[i+2],d[i+3]);
  }
  return {hgt,piv,reach,size,pos:new Float32Array(3*n),clump:new Float64Array(12*q.hier.nClusterTotal)};
}
// Every leaf of one end at its wind now, less its drift: plan point and height into pre.pos (x, y, z a leaf).
export function framePoints(q,pre){
  const d=q.leaves,p=q.params,m=q.motion,H=q.hier,G=H.clusterGeom,D=H.clusterData,S=H.swayData,C=pre.clump,faithful=p.faithful_canopy;
  for(let j=0;j<H.nClusterTotal;j++){
    const o=4*j,c=12*j,L=D[o],T=D[o+1],px=G[o+2],py=G[o+3];
    let tx=G[o],ty=G[o+1];
    if(!faithful){
      const dx=tx-px,dy=ty-py,r=Math.max(Math.hypot(dx,dy),.001),sa=D[o+2]*.6,cs=Math.cos(sa),sn=Math.sin(sa),len=Math.min(p.stem_length,r*.9);
      tx-=len*(cs*dx+sn*dy)/r;ty-=len*(-sn*dx+cs*dy)/r;
    }
    C[c]=tx;C[c+1]=ty;C[c+2]=px;C[c+3]=py;C[c+4]=Math.cos(L);C[c+5]=Math.sin(L);C[c+6]=Math.cos(T);C[c+7]=Math.sin(T);C[c+8]=T;
    C[c+9]=m.sway[0]+(S?S[o]:0);C[c+10]=m.sway[1]+(S?S[o+1]:0);
  }
  const P=pre.pos;
  for(let k=0,i=0;i<d.length;k++,i+=18){
    const j=Math.round(d[i+11]),o=4*j,c=12*j,pk=pre.piv[k];
    const ct=pk>0?Math.cos(C[c+8]*(1-pk)):C[c+6],st=pk>0?Math.sin(C[c+8]*(1-pk)):C[c+7],cl=C[c+4],sl=C[c+5],tx=C[c],ty=C[c+1],px=C[c+2],py=C[c+3];
    const dx=d[i]-tx,dy=d[i+1]-ty,xx=tx+ct*dx-st*dy-px,yy=ty+st*dx+ct*dy-py;
    const z=faithful ? D[o+2]+pre.hgt[k]*D[o+3] : p.canopy_base_height_m+pre.hgt[k]*p.canopy_thickness_m;
    const gain=faithful ? z/Math.max(q.hMax,.001) : 1+p.sway_height_gain*(z/p.canopy_base_height_m-1);
    P[3*k]=px+cl*xx-sl*yy+C[c+9]*gain;P[3*k+1]=py+sl*xx+cl*yy+C[c+10]*gain;P[3*k+2]=z;
  }
}
// The carriers' box at their progress (w, or each its own: wi(n)): [x0, y0, x1, y1, lowest, highest], widened by the larger end's drift.
export function carrierBox(a,b,pa,pb,ka,kb,wi,out){
  const A=pa.pos,B=pb.pos;
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity,h0=Infinity,h1=-Infinity;
  for(let n=0;n<ka.length;n++){
    const w=wi(n),ia=3*ka[n],ib=3*kb[n],x=A[ia]+(B[ib]-A[ia])*w,y=A[ia+1]+(B[ib+1]-A[ia+1])*w,z=A[ia+2]+(B[ib+2]-A[ia+2])*w;
    if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;if(z<h0)h0=z;if(z>h1)h1=z;
  }
  const e=Math.max(Math.abs(a.params.drift_amount)*pa.reach,Math.abs(b.params.drift_amount)*pb.reach);
  out[0]=x0-e;out[1]=y0-e;out[2]=x1+e;out[3]=y1+e;out[4]=h0;out[5]=h1;
  return out;
}

export function makeLeafTravel(hub,createScene){
  const {gl,params,trans}=hub;
  let s=null;
  const read=h=>{
    const leaves=new Float32Array(h.faith.count*18);
    gl.bindBuffer(gl.ARRAY_BUFFER,h.faith.buf);gl.getBufferSubData(gl.ARRAY_BUFFER,0,leaves);
    // The pivot weights as the bake reads them, beside the leaves in the same order; null where no leaf has one, which keeps the old arithmetic.
    let pivot=null;
    if(h.faith.pivotOn){pivot=new Float32Array(h.faith.count);gl.bindBuffer(gl.ARRAY_BUFFER,h.faith.pivotBuf);gl.getBufferSubData(gl.ARRAY_BUFFER,0,pivot);}
    return {leaves,pivot,hier:h.hier,params:h.params,motion:h.motion,hMax:h.faith.hMax,shape:h.grove.shape,texture:h.grove.leafTex,grove:h.grove};   // grove: its cluster textures, which its wind publishes
  };
  function beginLeafTravel(to){
    const from=createScene();
    s={from,a:read(from.hub),b:null,start:0,end:1,progress:0,lookA:{...params},lookB:{...to},pending:null,
      field:{tex:null,ox:0,oy:0,ext:1,weight:0},toneStart:[0,0,0],toneEnd:[0,0,0],patch:patchTravel(params,to)};
    s.toneStart[params.tone_map]=1;s.toneEnd[to.tone_map]=1;
  }
  function retargetLeafTravel(to,opts){
    // Reversing the same journey keeps its carriers and both wind states. Other requests wait for its settled frame.
    const same=p=>Object.keys(DEFAULTS).every(k=>k==='drift_phase'||k==='auto_quality'||k==='adaptive_motion'||p[k]===to[k]);
    const end=same(s.lookA)?0:same(s.lookB)?1:null;
    if(end===null){s.pending={to,opts};trans.onEnd=null;return false;}
    // The clock the router will run: the way back from the displayed progress and velocity (turnBack).
    const t=trans.t,v=s.turn?s.turn.rate(t):(s.end-s.start)*6*t*(1-t)/(trans.dur*trans.durScale);
    const dur=Math.max(1e-3,opts.duration!=null?opts.duration:trans.dur);
    s.pending=null;s.start=s.progress;s.end=end;s.turn=turnBack(s.progress,v,end,2*dur);
    s.toneStart=[...(trans.travelTone??s.toneStart)];s.toneEnd=[0,0,0];s.toneEnd[to.tone_map]=1;
    return s.turn.T/dur;
  }
  // The sun's mean throw per metre of height: a leaf's shadow falls, on average, at its plan point less g times its height.
  function meanThrow(proj){
    let gx=0,gy=0;
    for(let i=0;i<hub.src.count;i++){const sx=hub.src.flat[3*i],sy=hub.src.flat[3*i+1],wt=hub.src.flat[3*i+2];gx+=wt*(proj[0]*sx+proj[2]*sy);gy+=wt*(proj[1]*sx+proj[3]*sy);}
    return [gx,gy];
  }
  function init(){
    s.b=read(hub);
    if(s.patch){s.g=meanThrow(hub.projMatrix());s.pairs=patchPairs(s.a,s.b,s.g,PATCH_M/2);}
    else s.pairs=pairLeaves(s.a,s.b);
    // Local surpluses can require more carriers than either endpoint. Check the actual correspondence before allocating its cast.
    if(s.pairs.length>CANOPY_MORPH_MAX)return false;
    if(s.patch)initPatch();
    s.prep=[framePrep(s.a),framePrep(s.b)];s.frame=new Float64Array(6);
    s.ka=Int32Array.from(s.pairs,p=>p[0]/18);s.kb=Int32Array.from(s.pairs,p=>p[1]/18);
    s.pad=Math.max(.1,3*Math.max(s.prep[0].size,s.prep[1].size));   // three of the largest leaf's half sizes: the quad, its outline's box and a margin
    s.stride=s.patch?STRIDE_PATCH:12;
    // the carriers' pass: their records in, the stamp's floats out, into the buffer the stamp's vertex array reads
    s.carry=s.patch?hub.sharedProgram(VS_LEAF_CARRY_PATCH,FS_LEAF_CARRY,LEAF_CARRY_PATCH_OUT):hub.sharedProgram(VS_LEAF_CARRY,FS_LEAF_CARRY,LEAF_CARRY_OUT);
    s.cu=Object.fromEntries(CARRY_U.map(k=>[k,gl.getUniformLocation(s.carry,`u${k}`)]));
    s.rec=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,s.rec);gl.bufferData(gl.ARRAY_BUFFER,carrierRecords(s.a,s.b,s.pairs,s.trip),gl.STATIC_DRAW);
    s.recVao=gl.createVertexArray();gl.bindVertexArray(s.recVao);
    for(let i=0;i<CARRY_STRIDE/4;i++){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,4,gl.FLOAT,false,4*CARRY_STRIDE,i*16);}
    s.feedback=gl.createTransformFeedback();
    s.prog=s.patch?hub.sharedProgram(VS_LEAF_TRAVEL_PATCH,FS_LEAF_TRAVEL_PATCH):hub.sharedProgram(VS_LEAF_TRAVEL,FS_LEAF_TRAVEL);   // the engine's for the context's life, as the dissolve's mix is
    s.u=Object.fromEntries(['Origin','Extent','G','Box','LeafA','LeafB','ShapeA','ShapeB','Weight','Edge','BeamK','EdgeArea'].map(k=>[k,gl.getUniformLocation(s.prog,`u${k}`)]));
    s.buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,s.buf);gl.bufferData(gl.ARRAY_BUFFER,4*s.stride*s.pairs.length,gl.DYNAMIC_COPY);
    s.vao=gl.createVertexArray();gl.bindVertexArray(s.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER,hub.quadBuf);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,s.buf);
    for(let i=1;i<=s.stride/4;i++){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,4,gl.FLOAT,false,4*s.stride,(i-1)*16);gl.vertexAttribDivisor(i,1);}
    gl.bindVertexArray(null);
    s.textures=[gl.createTexture(),gl.createTexture()];s.fbos=[gl.createFramebuffer(),gl.createFramebuffer()];s.res=0;
    const boxes=[s.a.shape?.box??[0,0,1,1],s.b.shape?.box??[0,0,1,1]];
    const x0=Math.min(...boxes.map(b=>b[0]-b[2])),x1=Math.max(...boxes.map(b=>b[0]+b[2]));
    const y0=Math.min(...boxes.map(b=>b[1]-b[3])),y1=Math.max(...boxes.map(b=>b[1]+b[3]));
    s.box=[(x0+x1)/2,(y0+y1)/2,(x1-x0)/2,(y1-y0)/2];
  }
  // The uniforms the carriers' pass reads.
  const CARRY_U=['W','Edges','TripD','ClusterA','GeomA','ClusterB','GeomB','WindA','FlutterA','DriftA','HeightA','WindB','FlutterB','DriftB','HeightB'];
  // Once a frame, every carrier at both ends' wind now and carried to the progress (W, patch by patch), into the stamp's buffer.
  function carryPass(W){
    const u=s.cu;
    gl.useProgram(s.carry);gl.bindVertexArray(s.recVao);
    gl.uniform1f(u.W,W);gl.uniform2f(u.Edges,s.lookA.edge_softness,s.lookB.edge_softness);gl.uniform1f(u.TripD,TRIP_D);
    for(const [k,q,unit] of [['A',s.a,0],['B',s.b,2]]){
      const p=q.params,m=q.motion;
      gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,q.grove.clusterTex);gl.uniform1i(u[`Cluster${k}`],unit);
      gl.activeTexture(gl.TEXTURE0+unit+1);gl.bindTexture(gl.TEXTURE_2D,q.grove.clusterGeomTex);gl.uniform1i(u[`Geom${k}`],unit+1);
      gl.uniform4f(u[`Wind${k}`],m.u,m.sway[0],m.sway[1],m.time);
      gl.uniform4f(u[`Flutter${k}`],p.leaf_swing,p.flutter_freq,p.wind_air,p.wind_depth);
      gl.uniform4f(u[`Drift${k}`],p.drift_phase,p.drift_amount,p.stem_length,p.sway_height_gain);
      gl.uniform4f(u[`Height${k}`],p.faithful_canopy?1:0,p.canopy_base_height_m,p.canopy_thickness_m,q.hMax);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER,null);   // WebGL refuses feedback into a buffer still bound to another target
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,s.feedback);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,s.buf);
    gl.enable(gl.RASTERIZER_DISCARD);gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,s.pairs.length);gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);   // the buffer is the stamp's attribute next: it may not stay bound for feedback
  }
  function initPatch(){
    // A carrier's place in the patch field is read where its shadow falls, midway along its trip.
    const n=s.pairs.length,p0=moveLeaves(s.a,s.b,s.pairs,0,new Float32Array(n*12)),p1=moveLeaves(s.a,s.b,s.pairs,1,new Float32Array(n*12)),xy=new Float64Array(2*n);
    for(let i=0;i<n;i++)for(let c=0;c<2;c++)xy[2*i+c]=lerp(p0[12*i+c]-s.g[c]*p0[12*i+8],p1[12*i+c]-s.g[c]*p1[12*i+8],.5);
    s.trip=patchField(xy,PATCH_M);
    const locs=(prog,names)=>Object.fromEntries(names.map(k=>[k,gl.getUniformLocation(prog,`u${k}`)]));
    s.progressProg=hub.sharedProgram(VS_LEAF_TRAVEL_PATCH,FS_LEAF_PROGRESS);s.progressU=locs(s.progressProg,['Origin','Extent','G','Box']);
    s.blurProg=hub.sharedProgram(VS_FULL,FS_PROGRESS_BLUR);s.blurU=locs(s.blurProg,['Tex','Dir','Sigma']);
    s.mixProg=hub.sharedProgram(VS_FULL,FS_PATCH_MIX);s.mixU=locs(s.mixProg,['A','B','P']);
    s.ptex=[];s.pfbo=[];s.pics=[null,null,null];
    for(let i=0;i<2;i++){
      const t=gl.createTexture(),fb=gl.createFramebuffer();
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,t);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,PROGRESS_RES,PROGRESS_RES,0,gl.RGBA,gl.HALF_FLOAT,null);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
      s.ptex.push(t);s.pfbo.push(fb);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  }
  function stepLeafTravel(dt,t,e){
    hub.regenSource();   // the source this frame's morph left: the carriers' throw and the native share are cast from it
    if(!s.b&&init()===false){
      const from=s.from.hub;
      if(from.motionActive())from.motionTick(dt);
      Object.assign(params,s.lookA);s.end=0;
      return false;
    }
    const from=s.from.hub,phase=from.params.drift_phase;
    for(const k of MORPH_KEYS)from.params[k]=params[k];
    from.params.drift_phase=phase;
    if(from.motionActive())from.motionTick(dt);
    s.progress=s.turn?s.turn.at(t):lerp(s.start,s.end,e);
    trans.travelTone=s.toneStart.map((v,i)=>lerp(v,s.toneEnd[i],e));
    const f=s.field,w=s.progress;
    f.weight=smoothstep(0,TRAVEL_HANDOFF,w)*smoothstep(0,TRAVEL_HANDOFF,1-w);
    trans.travelField=f;
    // Patch by patch the colour follows the trips: 0 and 1 through the handoffs, each end's own picture; between, a mix.
    const W=tripW(w);
    if(s.patch){s.colour=smoothstep(0,1,W);f.progressGlobal=s.colour;f.progressTex=null;}
    if(f.weight===0)return;
    framePoints(s.a,s.prep[0]);framePoints(s.b,s.prep[1]);
    const box=carrierBox(s.a,s.b,s.prep[0],s.prep[1],s.ka,s.kb,s.patch?n=>tripClock(s.trip[n],W):()=>w,s.frame);
    let [x0,y0,x1,y1]=box;const h0=box[4],h1=box[5],pad=s.pad;
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
    f.tex=s.textures[0];carryPass(s.patch?W:w);
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
    if(s.patch&&s.colour>0&&s.colour<1)bakeProgress(proj);
  }
  // The colour map: the carriers' own progress where their shadows fall (at the mean throw), coverage-weighted, then
  // blurred over a third of a patch so it reaches into the gaps between leaves.
  function bakeProgress(proj){
    const f=s.field,g=meanThrow(proj),U=s.progressU;
    gl.viewport(0,0,PROGRESS_RES,PROGRESS_RES);gl.bindFramebuffer(gl.FRAMEBUFFER,s.pfbo[0]);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(s.progressProg);gl.bindVertexArray(s.vao);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);
    gl.uniform2f(U.Origin,f.ox,f.oy);gl.uniform2f(U.Extent,f.ext,f.ext);gl.uniform4fv(U.Box,s.box);gl.uniform2f(U.G,g[0],g[1]);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,s.pairs.length);gl.disable(gl.BLEND);
    gl.useProgram(s.blurProg);gl.bindVertexArray(hub.emptyVAO);gl.uniform1f(s.blurU.Sigma,PATCH_M/3/(f.ext/PROGRESS_RES));gl.uniform1i(s.blurU.Tex,0);
    for(const [from,to,dx,dy] of [[0,1,1,0],[1,0,0,1]]){
      gl.bindFramebuffer(gl.FRAMEBUFFER,s.pfbo[to]);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,s.ptex[from]);
      gl.uniform2f(s.blurU.Dir,dx/PROGRESS_RES,dy/PROGRESS_RES);gl.drawArrays(gl.TRIANGLES,0,3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    f.progressTex=s.ptex[0];
  }
  function drawLeafTravel(){
    const outgoing=s.progress<.5,h=outgoing?s.from.hub:hub;
    if(outgoing)Object.assign(h.trans,{active:true,iris:trans.iris,irisOpacity:trans.irisOpacity,travelField:s.field,travelTone:trans.travelTone});
    const diffuse=h.params.leaf_diffuse;
    // Zero selects a different native texel law. Let the moving cast carry that change, rather than snapping it at landing.
    h.params.leaf_diffuse=(outgoing?s.lookA:s.lookB).leaf_diffuse;
    h.regenSource();
    // The native share must contain this frame's wind, even while the moving cast hides most of it.
    if(s.field.weight<1)h.bake();
    if(s.patch)drawPatches(h);
    else h.drawFrameInto(null,hub.canvas.width,hub.canvas.height);
    h.params.leaf_diffuse=diffuse;
  }
  function target(old){
    const W=hub.canvas.width,H=hub.canvas.height;
    if(old&&old.w===W&&old.h===H)return old;
    if(old){gl.deleteTexture(old.tex);gl.deleteFramebuffer(old.fbo);}
    const tex=gl.createTexture(),fbo=gl.createFramebuffer();
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,W,H,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {tex,fbo,w:W,h:H};
  }
  // Patch by patch the one moving field is finished twice, in the outgoing look's grade and tone curve and in the
  // incoming one's, and mixed per pixel by the colour map: a patch that has turned is lit and graded as the incoming look.
  function drawPatches(h){
    const W=hub.canvas.width,H=hub.canvas.height,c=s.colour,f=s.field;
    const picture=(side,fbo)=>{
      const look=side?s.lookB:s.lookA,saved={},tone=h.trans.travelTone,one=[0,0,0];
      for(const k of GRADE_KEYS){saved[k]=h.params[k];h.params[k]=look[k];}
      one[look.tone_map]=1;h.trans.travelTone=one;
      h.drawFrameInto(fbo,W,H);
      h.trans.travelTone=tone;Object.assign(h.params,saved);
    };
    if(!(c>0&&c<1&&f.progressTex))return picture(c>=1?1:0,null);
    for(let i=0;i<3;i++)s.pics[i]=target(s.pics[i]);
    picture(0,s.pics[0].fbo);picture(1,s.pics[1].fbo);
    f.progressOut=true;h.drawFrameInto(s.pics[2].fbo,W,H);f.progressOut=false;
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,W,H);gl.disable(gl.BLEND);
    gl.useProgram(s.mixProg);gl.bindVertexArray(hub.emptyVAO);
    for(const [unit,k] of [[0,'A'],[1,'B'],[2,'P']]){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,s.pics[unit].tex);gl.uniform1i(s.mixU[k],unit);}
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  function finishLeafTravel(){
    if(s.end===0)s.from.restore();
    return s.pending;
  }
  function endLeafTravel(){
    if(!s)return;
    const pending=s.pending;
    s.from.dispose();
    if(s.vao)gl.deleteVertexArray(s.vao);if(s.buf)gl.deleteBuffer(s.buf);
    if(s.recVao)gl.deleteVertexArray(s.recVao);if(s.rec)gl.deleteBuffer(s.rec);if(s.feedback)gl.deleteTransformFeedback(s.feedback);
    s.textures?.forEach(t=>{gl.deleteTexture(t);});s.fbos?.forEach(f=>{gl.deleteFramebuffer(f);});
    s.ptex?.forEach(t=>{gl.deleteTexture(t);});s.pfbo?.forEach(f=>{gl.deleteFramebuffer(f);});
    s.pics?.forEach(p=>{if(p){gl.deleteTexture(p.tex);gl.deleteFramebuffer(p.fbo);}});
    s=null;trans.travelField=null;trans.travelTone=null;
    return pending;
  }
  // The route's entry (komorebi-routes.js): the look's live keys morph under it, drift left to the wind; the ground's
  // brightest channel goes straight between the ends' (one field of dapples in a colour between two looks).
  return {name:'leafTravel',begin:beginLeafTravel,retarget:retargetLeafTravel,step:stepLeafTravel,draw:drawLeafTravel,finish:finishLeafTravel,end:endLeafTravel,
    tweens:true,keepsDrift:true,groundPeak:true,landing:['regenSource','resetPerf','bake']};
}
