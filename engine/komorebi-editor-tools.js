// ============================================================================
// Editor tools (EDITOR only, spec/implementation.md) — everything the dev pages use and the
// player build strips: the source + tree-preview debug overlays, the GPU timer
// queries test-gl/cost.mjs reads, and the motion mirror that drives one engine's
// wind from another. One factory, called under
// if(EDITOR), that hangs its surface on the engine's shared internals (hub).
// ============================================================================
import { DEG, clamp, hash3, lerp, makeGauss, mulberry32 } from './komorebi-math.js';
import { placeLeaf } from './canopy/komorebi-grove.js';

// One blob per LEAF of the grove (count = leaves_per_cluster × foliage_density), each at the grove's own place for it: per leaf x, y, z, cov, the
// tree's warmth, and its size. The tree inset and the workspace's tree pane (tree-pane.js) both draw these.
export function groveLeaves(hier, params, faithful){
  // Drive the preview off the grove's TWIGS (one cluster per leaf-bearing node) — NOT terminal segments. With droop,
  // a twig is split into sub-segments all tagged level≥levels, so the old segment-filter over-drew nSub×nLeaf clusters
  // at mid-twig joints and mis-keyed the per-twig seed by segment index. Iterating twigs[] matches the bake's count,
  // per-twig seed (hash3(seed,j,101)), hug heading (t.dx/t.dy) and marginal-leaf fade. (spec/implementation.md — preview ≈ bake)
  const tws = hier.twigs || [];
  const pcF = Math.max(0, params.leaves_per_cluster*params.foliage_density);
  const pcInt = Math.floor(pcF), frac = pcF - pcInt;
  const nLeaf = pcInt + (frac>1e-4 ? 1 : 0);
  const base=[];
  const lw = hier.leafW;       // abscission (spec/model/season.md): each leaf's retained weight by (twig, slot), the grove's own; null while nothing can have dropped
  const pos = [0,0,0,0,0,0];
  for(let j=0;j<tws.length;j++){
    const t=tws[j], tcov=(t.tcov===undefined?1:t.tcov);
    const ti=(t.tree===undefined?0:t.tree), tnt=((ti*0.61803398875)%1)*2-1;   // per-tree warmth [-1,1], golden-spread so neighbours differ
    const rng=mulberry32(hash3(params.seed>>>0, j, 101)), gauss=makeGauss(rng);   // the grove's own arrangement stream for this twig (j = twig index == the bake's seed)
    for(let k=0;k<nLeaf;k++){
      const g1=gauss(), g2=gauss();   // leaves hug the twig — must match the bake (spec/model/canopy.md)
      const sz=0.6+0.8*rng();         // ...and the seven draws the grove makes per leaf after them (size, tilt, angle, the orbit pair, orient, phase), so this leaf's two gaussians ARE the grove's: the preview shows the cast's leaf.
      for(let q=1;q<7;q++) rng();     // The first is the leaf's size (× leaf_size_m), which the preview draws it at.
      // (EDITOR-ONLY CHANGE, and at inner_leaves 0 too: this inset used to walk the gaussian stream alone, so its leaf k was another draw of the same count and spread, not the cast's leaf, and its scatter
      // at 0 was not the cast's; walking the grove's draw order makes it the cast's. No frame the engine renders moves; only the T inset's blobs sit elsewhere than they did at 9d8f3ad, where the cast has them.)
      const w = lw ? lw[j*nLeaf+k] : 1;                // a leaf the grove has compacted out is gone here too (the draws above still run: the next leaf's scatter must not move)
      if(w === 0) continue;
      const cov = ((k===pcInt) ? frac : 1.0) * tcov * w;   // marginal-leaf fade × marginal-tree fade — matches the bake (E#54), so a density morph tracks the cast — × the leaf's fade out (spec/contracts/continuity.md)
      placeLeaf(hier, j, g1, g2, k, params, faithful, pos, sz*params.leaf_size_m);   // the grove's own placement, one function (komorebi-grove.js): the twig hug off the tip and, with inner_leaves up, the leaves on the older wood, at their own heights
      base.push(pos[0], pos[1], pos[2], cov, tnt, sz);
    }
  }
  return new Float32Array(base);
}

export function makeEditorTools(hub){
  const { gl, canvas, params, motion, src, U, faithfulOn } = hub;   // the GL handles (programs, extTimer) are read as hub.x: initGPU() replaces them on a context restore

  // the debug overlays' buffers + the profiler's GPU objects: created here, and again by initGPU() after a context restore
  function initEditorGL(){
    hub.srcDbgBuf = gl.createBuffer();
    hub.srcDbgVAO = gl.createVertexArray();
    gl.bindVertexArray(hub.srcDbgVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, hub.srcDbgBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,12,0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,1,gl.FLOAT,false,12,8);
    gl.bindVertexArray(null);

    // tree-preview inset buffer: interleaved (pos.xy, col.rgb, size) — 6 floats/vertex, refilled per frame
    hub.vizBuf = gl.createBuffer();
    hub.vizVAO = gl.createVertexArray();
    gl.bindVertexArray(hub.vizVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, hub.vizBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,24,0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,3,gl.FLOAT,false,24,8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,1,gl.FLOAT,false,24,20);
    gl.bindVertexArray(null);
    tq.bake.q = [null,null]; tq.transport.q = [null,null];           // dead timer queries must not be polled
  }

  hub.drawSourceInset = () => {
    const s=Math.round(Math.min(170, canvas.width*0.22));
    const x=canvas.width-s-8, y=canvas.height-s-8;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x,y,s,s); gl.viewport(x,y,s,s);
    gl.clearColor(0.03,0.04,0.06,1.0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(hub.progPoints);
    gl.uniform1f(U.pts.scale, 0.92/src.maxR);
    gl.uniform1f(U.pts.maxW, src.maxW);
    gl.bindVertexArray(hub.srcDbgVAO);
    gl.drawArrays(gl.POINTS, 0, src.count);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0,0,canvas.width,canvas.height);
  };

  // ---- 3D preview of the ACTUAL grove (todo [3]): the grown skeleton + leaf blobs, in a slowly
  // turning 3/4 view that sways with the wind. Optional editor inset ('T'); the geometry is CPU-
  // projected into a scissored corner, so it costs nothing unless shown. ----
  let treeGrow = 0;   // 0 = parked small in the corner, 1 = grown; eases toward the hover/pinned target
  // inset leaf scatter: one blob per LEAF (count = leaves_per_cluster × foliage_density) so the density
  // slider visibly fills/thins the preview. Base positions are scattered once per regrow (keyed on `hier`
  // identity — every canopy knob makes a new hier) and reprojected each frame; the proj buffer is reused.
  let treeLeafHier=null, treeLeafW=null, treeLeafBase=null, treeLeafProj=null;
  function buildTreeLeaves(){
    treeLeafBase=groveLeaves(hub.hier, params, faithfulOn());   // faithful hoisted: it must be the SAME answer regenCanopy packed the bake with
    treeLeafProj=new Float32Array(treeLeafBase.length);   // base: x,y,z,cov,tint,size (6) -> proj: x,y,r,g,b,size (6)
    treeLeafHier=hub.hier; treeLeafW=hub.hier.leafW;
  }
  // the grove's leaves as the inset and the workspace's tree pane draw them (x, y, z, cov, tint, size per leaf), rebuilt only for a new grove
  hub.treeLeaves = () => { if(treeLeafHier!==hub.hier || treeLeafW!==hub.hier.leafW) buildTreeLeaves(); return treeLeafBase; };
  function treeInsetGeom(){
    const base = Math.min(300, canvas.width*0.32, canvas.height*0.42);
    const big  = Math.min(canvas.width*0.62, canvas.height*0.72);
    const S = Math.round(base + (big-base)*treeGrow);
    return { S, ix: canvas.width-S-8, iy: 8 };        // anchored bottom-right; grows up-left
  }
  hub.treeInsetRect = treeInsetGeom;                     // where the inset is drawn now, in GL pixels (iy from the bottom): the dev bridge crops it
  hub.treeInsetHit = (ptr) => {                          // is the normalised pointer over the current inset?
    if(!ptr) return false;
    const {S,ix,iy}=treeInsetGeom();
    const l=ix/canvas.width, r=(ix+S)/canvas.width, tp=1-(iy+S)/canvas.height, bt=1-iy/canvas.height;
    return ptr.x>=l && ptr.x<=r && ptr.y>=tp && ptr.y<=bt;
  };
  // grow while hovered; a CLICK pins it big (pinned) until clicked again. ptr = normalised coords or null.
  hub.drawTreeInset = (ptr, pinned) => {
    if(!hub.hier?.segments?.length) return;
    const segs = hub.hier.segments, levels = Math.max(1, params.branch_levels|0);
    treeGrow = clamp(treeGrow + (((pinned||hub.treeInsetHit(ptr))?1:0)-treeGrow)*0.18, 0, 1);   // smooth ease
    const { S, ix, iy } = treeInsetGeom();
    // grove bounds for the fit scale
    let R=1e-3, maxZ=1e-3;
    for(const s of segs){ R=Math.max(R, Math.hypot(s.a[0],s.a[1]), Math.hypot(s.b[0],s.b[1])); maxZ=Math.max(maxZ, s.a[2], s.b[2]); }
    const fit = 0.72/Math.max(R, maxZ);
    const tt = performance.now()/1000;
    const yaw = tt*0.25, cyw=Math.cos(yaw), syw=Math.sin(yaw);     // slow turntable so it reads as 3D
    const pitch = 24*DEG, hk=Math.cos(pitch), dk=Math.sin(pitch);
    const wx=motion.windX, wy=motion.windY;   // EFFECTIVE wind dir (weather-veered) — matches the bake & trunk drift
    const lean = motion.u*0.9, sx0=motion.sway[0], sy0=motion.sway[1];   // wind: lean + trunk drift (drift carries the lateral channel)
    // NOTE: motion.u is intentionally applied TWICE here — as the height-weighted `lean` (a cheap proxy for the bake's
    // per-joint limb/twig rotation, which the preview doesn't re-derive) and again inside motion.sway (the trunk drift).
    // So the preview leans a touch harder than the bake translates; that's by design (spec/implementation.md — preview ≈ bake, not =).
    const offY = -0.4;
    const P = (p) => {                                   // 3D world (+wind) -> inset NDC
      const lf = lean*(p[2]/maxZ);                       // taller points lean more downwind
      const ax=p[0]+wx*lf+sx0, ay=p[1]+wy*lf+sy0, az=p[2];   // true height: the preview is where a tree's proportions are judged
      const u=ax*cyw-ay*syw, depth=ax*syw+ay*cyw;
      return [ u*fit, (az*hk - depth*dk)*fit + offY ];
    };
    const L=[]; const pushLine=(p,q,r,g,b)=>{ const A=P(p),B=P(q); L.push(A[0],A[1],r,g,b,0, B[0],B[1],r,g,b,0); };
    // ground grid (z=0)
    const gExt=R*1.05, gN=4;
    for(let i=-gN;i<=gN;i++){ const f=i/gN*gExt;
      pushLine([f,-gExt,0],[f,gExt,0], 0.15,0.17,0.15);
      pushLine([-gExt,f,0],[gExt,f,0], 0.15,0.17,0.15); }
    // wind-direction arrow on the ground (only when the wind is blowing)
    if(params.wind_strength>0){ const aL=gExt*0.85, tx=wx*aL, ty=wy*aL, hb=gExt*0.16;
      const rot=(a)=>[wx*Math.cos(a)-wy*Math.sin(a), wx*Math.sin(a)+wy*Math.cos(a)];
      pushLine([0,0,0],[tx,ty,0], 0.5,0.6,0.78);
      const h1=rot(2.6), h2=rot(-2.6);
      pushLine([tx,ty,0],[tx+h1[0]*hb,ty+h1[1]*hb,0], 0.5,0.6,0.78);
      pushLine([tx,ty,0],[tx+h2[0]*hb,ty+h2[1]*hb,0], 0.5,0.6,0.78); }
    // branches as tapered quads (real width, not 1-px GL lines): trunk thickest -> twig thin. Built into a
    // triangles buffer Q, drawn solid behind the foliage and again faintly OVER it so the skeleton ghosts
    // through (level<=1 brown -> twig tan; cov<1 fades a marginal morphing-in tree toward the sky bg).
    const Q=[]; const pushQuad=(p,q,wpx,r,g,b)=>{
      const A=P(p),B=P(q); let dxn=B[0]-A[0],dyn=B[1]-A[1]; const dl=Math.hypot(dxn,dyn)||1e-6; dxn/=dl; dyn/=dl;
      const hw=wpx/S, nx=-dyn*hw, ny=dxn*hw;                  // perpendicular half-width in NDC (square S×S viewport)
      Q.push(A[0]+nx,A[1]+ny,r,g,b,0, A[0]-nx,A[1]-ny,r,g,b,0, B[0]+nx,B[1]+ny,r,g,b,0,
             A[0]-nx,A[1]-ny,r,g,b,0, B[0]-nx,B[1]-ny,r,g,b,0, B[0]+nx,B[1]+ny,r,g,b,0); };
    // branch width follows the SAME pipe-model taper as the shadow occluder (reflects taper_delta), so the
    // preview shows thick-trunk → thin-twig exactly as the cast silhouette will: width × children^(−1/Δ) per level.
    const pkids=Math.max(1,params.branch_children|0), ptf=Math.pow(Math.max(1.001,pkids), -1/clamp(params.taper_delta,1,4));
    for(const s of segs){ const f=Math.max(0, Math.min(1,(s.level-1)/Math.max(1,levels-1))), cv=(s.cov===undefined?1:s.cov);
      const wpx=Math.max(0.6, 4.4*Math.pow(ptf, s.level));   // trunk (level 0) thick -> twig thin, by Δ
      pushQuad(s.a, s.b, wpx, lerp(0.05,0.30+0.20*f,cv), lerp(0.07,0.22+0.16*f,cv), lerp(0.09,0.12+0.06*f,cv)); }
    // leaf blobs: the scatter on every terminal twig, so the density slider fills/thins the preview.
    if(treeLeafHier!==hub.hier || treeLeafW!==hub.hier.leafW) buildTreeLeaves();   // a re-season (spec/model/season.md) keeps the hier and makes a new leafW
    // each leaf at its own size, as the cast has it: its length in the inset's pixels (an NDC unit is S/2 px), never under 1.5 px.
    // (EDITOR-ONLY CHANGE: it was a blob 4% of the inset wide whatever the leaf, which made a crown of a few thousand small leaves
    // a solid bush the cast never showed; at its true size a leaf needs no haze to let the branches through, so it is drawn near opaque.)
    const lpx=params.leaf_size_m*fit*S*0.5, nLf=treeLeafBase.length/6;
    const leafAlpha=0.85;
    for(let i=0;i<nLf;i++){                                  // inline P() — no per-leaf array alloc (there can be tens of thousands)
      const b5=6*i, bx=treeLeafBase[b5], by=treeLeafBase[b5+1], bz=treeLeafBase[b5+2], cv=treeLeafBase[b5+3], w=treeLeafBase[b5+4];
      const lf=lean*(bz/maxZ), ax=bx+wx*lf+sx0, ay=by+wy*lf+sy0, az=bz;
      const u=ax*cyw-ay*syw, depth=ax*syw+ay*cyw, f=bz/maxZ, o=6*i, vv=1.0+w*0.10;   // w: per-tree warmth -> hue + value shift
      treeLeafProj[o]=u*fit; treeLeafProj[o+1]=(az*hk-depth*dk)*fit+offY;
      treeLeafProj[o+2]=lerp(0.05,0.18+0.12*f,cv)*(1.0+w*0.28)*vv;   // warm trees redder...
      treeLeafProj[o+3]=lerp(0.07,0.42+0.18*f,cv)*(1.0+w*0.05)*vv;
      treeLeafProj[o+4]=lerp(0.09,0.16+0.10*f,cv)*(1.0-w*0.28)*vv;   // ...and cooler trees bluer
      treeLeafProj[o+5]=Math.max(1.5, lpx*treeLeafBase[b5+5]);
    }
    // ---- draw: framed sky, ground+arrow lines, branches (solid), leaf haze, branches again (faint, over) ----
    gl.disable(gl.BLEND);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(ix-1,iy-1,S+2,S+2); gl.clearColor(0.16,0.20,0.16,1.0); gl.clear(gl.COLOR_BUFFER_BIT);   // frame
    gl.scissor(ix,iy,S,S); gl.viewport(ix,iy,S,S);
    gl.clearColor(0.05,0.07,0.09,1.0); gl.clear(gl.COLOR_BUFFER_BIT);                                    // sky
    gl.useProgram(hub.progViz);
    gl.bindVertexArray(hub.vizVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, hub.vizBuf);
    gl.uniform1f(U.viz.point, 0.0); gl.uniform1f(U.viz.lineAlpha, 1.0);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(L), gl.DYNAMIC_DRAW);     // ground grid + wind arrow
    gl.drawArrays(gl.LINES, 0, L.length/6);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(Q), gl.DYNAMIC_DRAW);     // branches, solid (behind the foliage)
    gl.drawArrays(gl.TRIANGLES, 0, Q.length/6);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1f(U.viz.point, 1.0); gl.uniform1f(U.viz.pointAlpha, leafAlpha);
    gl.bufferData(gl.ARRAY_BUFFER, treeLeafProj, gl.DYNAMIC_DRAW);            // leaf haze
    gl.drawArrays(gl.POINTS, 0, treeLeafProj.length/6);
    gl.uniform1f(U.viz.point, 0.0); gl.uniform1f(U.viz.lineAlpha, 0.4);       // faint skeleton ghosting through the foliage
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(Q), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, Q.length/6);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0,0,canvas.width,canvas.height);
  };

  // ---- profiling primitive (spec/implementation.md). The engine owns measurement because it owns the GL passes; the
  // cost tool (test-gl/cost.mjs) reads it. hub.timed defaults to a passthrough (so frame() is unaffected in
  // the player build, where this whole module dead-strips); this swaps in real GPU timer queries. ----
    let instrumenting = false;
    const TIME_ELAPSED = 0x88BF, GPU_DISJOINT = 0x8FBB;   // EXT_disjoint_timer_query_webgl2 enums
    const tq = { bake:{q:[null,null], i:0}, transport:{q:[null,null], i:0} };
    hub.timed = (pass, draw) => {
      if(!instrumenting || !hub.extTimer){ draw(); return; }
      const r = tq[pass], cur = r.q[r.i&1];               // this slot's query, issued 2 frames ago (ready now)
      if(cur){
        if(gl.getQueryParameter(cur, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(GPU_DISJOINT))
          hub.profiler[pass==='bake'?'bakeMs':'transportMs'] = gl.getQueryParameter(cur, gl.QUERY_RESULT)/1e6;
        gl.deleteQuery(cur);
      }
      const q = gl.createQuery();
      gl.beginQuery(TIME_ELAPSED, q); draw(); gl.endQuery(TIME_ELAPSED);
      r.q[r.i&1] = q; r.i++;                               // self-advance: each pass flips its own ring per frame
    };
    hub.profiler = { hasTimer: !!hub.extTimer, bakeMs:0, transportMs:0, setInstrument(on){ instrumenting=!!on; } };   // read by test-gl/cost.mjs

  // ---- motion mirror: drive this engine's wind EXACTLY from another instance instead of its own
  // physics, so two engines animate in lockstep (the test tools that drive two). Sound only while the two share the
  // grove skeleton (tree/limb/branch/seed), so the spring arrays line up 1:1. Holds across faithful_canopy too:
  // flipping it keeps the same grown grove and spring arrays — only the cast path (layer vs per-sample bake)
  // changes. snapshotMotion exposes
  // live refs (read-only); applyMotion copies them in + re-uploads the bend texture; setMotionSource swaps the
  // per-frame tick for a copy-from-source. The bake only reads angles + sway + time, so velocities aren't needed. ----
    hub.snapshotMotion = () => ({ m:motion, dphase:params.drift_phase, lA:hub.hier?.limbAngle, lP:hub.hier?.limbPitch, tA:hub.hier?.twigAngle, air:hub.hier?.airData });
    hub.applyMotion = (s) => {
      if(!s) return;
      const sm=s.m;
      motion.time=sm.time; motion.u=sm.u; motion.v=sm.v; motion.uLat=sm.uLat; motion.vLat=sm.vLat;
      motion.env=sm.env; motion.driveEnv=sm.driveEnv; motion.windX=sm.windX; motion.windY=sm.windY; motion.weatherS=sm.weatherS;
      motion.sway[0]=sm.sway[0]; motion.sway[1]=sm.sway[1];
      motion.trunks = sm.trunks ? structuredClone(sm.trunks) : null;   // every tree's trunk but tree 0's, which publishBend reads
      motion.airEnv = sm.airEnv;                                      // the open air's G beside a sheltered tree 0 (wind_shelter)
      params.drift_phase = s.dphase;                       // incoherent band rides a param the source advances
      if(hub.hier && s.lA && hub.hier.limbAngle.length===s.lA.length){
        hub.hier.limbAngle.set(s.lA); hub.hier.limbPitch.set(s.lP); hub.hier.twigAngle.set(s.tA);   // BOTH limb DOFs, or the wipe's two engines foreshorten differently
        hub.publishBend(hub.grove);                                // push the mirrored bend into the texture the bake reads
        if(s.air && hub.hier.airData.length===s.air.length){ hub.hier.airData.set(s.air); hub.uploadAir(hub.grove); }   // and the air at each clump, the leaves' flutter under wind_air
      }
    };
    hub.setMotionSource = (src) => { hub.motionTick = src ? () => hub.applyMotion(src.snapshotMotion()) : hub.tick; };

  hub.initEditorGL = initEditorGL;
  initEditorGL();
}
