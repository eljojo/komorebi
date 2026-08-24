// ============================================================================
// Editor tools (EDITOR only, spec §9) — everything the dev pages use and the
// player build strips: the source + tree-preview debug overlays, the profiling
// primitive (GPU timer ring + the stress-burst bench target), and the motion
// mirror that drives one engine's wind from another. One factory, called under
// if(EDITOR), that hangs its surface on the engine's shared internals (hub).
// ============================================================================
import { DEG, clamp, hash3, lerp, makeGauss, mulberry32 } from './komorebi-math.js';

export function makeEditorTools(hub){
  const { gl, canvas, params, motion, src, U, extTimer, faithfulOn, progPoints, progViz } = hub;
  let benchW = 0, benchH = 0;      // profiler stress-burst size (the FBO/texture live on hub so dispose() can free them)

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

  hub.drawSourceInset = () => {
    const s=Math.round(Math.min(170, canvas.width*0.22));
    const x=canvas.width-s-8, y=canvas.height-s-8;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x,y,s,s); gl.viewport(x,y,s,s);
    gl.clearColor(0.03,0.04,0.06,1.0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(progPoints);
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
  let treeLeafHier=null, treeLeafBase=null, treeLeafProj=null;
  function buildTreeLeaves(){
    // Drive the preview off the grove's TWIGS (one cluster per leaf-bearing node) — NOT terminal segments. With droop,
    // a twig is split into sub-segments all tagged level≥levels, so the old segment-filter over-drew nSub×nLeaf clusters
    // at mid-twig joints and mis-keyed the per-twig seed by segment index. Iterating twigs[] matches the bake's count,
    // per-twig seed (hash3(seed,j,101)), hug heading (t.dx/t.dy) and marginal-leaf fade. (spec §9 — preview ≈ bake)
    const tws = hub.hier.twigs || [];
    const pcF = Math.max(0, params.leaves_per_cluster*params.foliage_density);
    const pcInt = Math.floor(pcF), frac = pcF - pcInt;
    const nLeaf = pcInt + (frac>1e-4 ? 1 : 0);
    const base=[];
    const faithful = faithfulOn();   // hoisted, and it must be the SAME answer regenCanopy packed the bake with
    for(let j=0;j<tws.length;j++){
      const t=tws[j], cx=t.x, cy=t.y, cz=t.z, tcov=(t.tcov===undefined?1:t.tcov);
      const ti=(t.tree===undefined?0:t.tree), tnt=((ti*0.61803398875)%1)*2-1;   // per-tree warmth [-1,1], golden-spread so neighbours differ
      let tdx=t.dx||0, tdy=t.dy||0; const tdl=Math.hypot(tdx,tdy), tHasDir=tdl>1e-4; if(tHasDir){ tdx/=tdl; tdy/=tdl; }   // grown twig heading (the bake's stored t.dx,t.dy), so the hug matches even on a drooped twig
      const gauss=makeGauss(mulberry32(hash3(params.seed>>>0, j, 101)));   // per-twig scatter, j = twig index == the bake's seed (same count & spread, not bit-identical)
      for(let k=0;k<nLeaf;k++){
        const g1=gauss(), g2=gauss();   // leaves hug the twig — must match the bake (§4.5)
        const cov = ((k===pcInt) ? frac : 1.0) * tcov;   // marginal-leaf fade × marginal-tree fade — matches the bake (E#54), so a density morph tracks the cast
        const hug = faithful && tHasDir;
        const x = hug ? cx - Math.abs(g1)*params.cluster_spread_m*1.5*tdx - g2*params.cluster_spread_m*0.4*tdy : cx + g1*params.cluster_spread_m;
        const y = hug ? cy - Math.abs(g1)*params.cluster_spread_m*1.5*tdy + g2*params.cluster_spread_m*0.4*tdx : cy + g2*params.cluster_spread_m;
        base.push(x, y, cz, cov, tnt);
      }
    }
    treeLeafBase=new Float32Array(base);
    treeLeafProj=new Float32Array(base.length/5*6);   // base: x,y,z,cov,tint (5) -> proj: x,y,r,g,b,size (6)
    treeLeafHier=hub.hier;
  }
  function treeInsetGeom(){
    const base = Math.min(300, canvas.width*0.32, canvas.height*0.42);
    const big  = Math.min(canvas.width*0.62, canvas.height*0.72);
    const S = Math.round(base + (big-base)*treeGrow);
    return { S, ix: canvas.width-S-8, iy: 8 };        // anchored bottom-right; grows up-left
  }
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
    const fit = 0.72/Math.max(R, maxZ*1.4);
    const tt = performance.now()/1000;
    const yaw = tt*0.25, cyw=Math.cos(yaw), syw=Math.sin(yaw);     // slow turntable so it reads as 3D
    const pitch = 24*DEG, hk=Math.cos(pitch), dk=Math.sin(pitch);
    const wx=motion.windX, wy=motion.windY;   // EFFECTIVE wind dir (weather-veered) — matches the bake & trunk drift
    const lean = motion.u*0.9, sx0=motion.sway[0], sy0=motion.sway[1];   // wind: lean + trunk drift (drift carries the lateral channel)
    // NOTE: motion.u is intentionally applied TWICE here — as the height-weighted `lean` (a cheap proxy for the bake's
    // per-joint limb/twig rotation, which the preview doesn't re-derive) and again inside motion.sway (the trunk drift).
    // So the preview leans a touch harder than the bake translates; that's by design (spec §9 — preview ≈ bake, not =).
    const offY = -0.4;
    const P = (p) => {                                   // 3D world (+wind) -> inset NDC
      const lf = lean*(p[2]/maxZ);                       // taller points lean more downwind
      const ax=p[0]+wx*lf+sx0, ay=p[1]+wy*lf+sy0, az=p[2]*1.4;
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
    if(treeLeafHier!==hub.hier) buildTreeLeaves();
    const lsz=S*0.04, nLf=treeLeafBase.length/5;
    // per-leaf opacity falls as the per-twig count climbs, so a dense canopy reads as a translucent haze the
    // branches show through (option 3) instead of an opaque green wall — density stays legible as coverage.
    const leafAlpha=clamp(1.8/Math.sqrt(Math.max(1,Math.round(params.leaves_per_cluster*params.foliage_density))),0.12,0.6);
    for(let i=0;i<nLf;i++){                                  // inline P() — no per-leaf array alloc (there can be tens of thousands)
      const b5=5*i, bx=treeLeafBase[b5], by=treeLeafBase[b5+1], bz=treeLeafBase[b5+2], cv=treeLeafBase[b5+3], w=treeLeafBase[b5+4];
      const lf=lean*(bz/maxZ), ax=bx+wx*lf+sx0, ay=by+wy*lf+sy0, az=bz*1.4;
      const u=ax*cyw-ay*syw, depth=ax*syw+ay*cyw, f=bz/maxZ, o=6*i, vv=1.0+w*0.10;   // w: per-tree warmth -> hue + value shift
      treeLeafProj[o]=u*fit; treeLeafProj[o+1]=(az*hk-depth*dk)*fit+offY;
      treeLeafProj[o+2]=lerp(0.05,0.18+0.12*f,cv)*(1.0+w*0.28)*vv;   // warm trees redder...
      treeLeafProj[o+3]=lerp(0.07,0.42+0.18*f,cv)*(1.0+w*0.05)*vv;
      treeLeafProj[o+4]=lerp(0.09,0.16+0.10*f,cv)*(1.0-w*0.28)*vv;   // ...and cooler trees bluer
      treeLeafProj[o+5]=lsz;
    }
    // ---- draw: framed sky, ground+arrow lines, branches (solid), leaf haze, branches again (faint, over) ----
    gl.disable(gl.BLEND);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(ix-1,iy-1,S+2,S+2); gl.clearColor(0.16,0.20,0.16,1.0); gl.clear(gl.COLOR_BUFFER_BIT);   // frame
    gl.scissor(ix,iy,S,S); gl.viewport(ix,iy,S,S);
    gl.clearColor(0.05,0.07,0.09,1.0); gl.clear(gl.COLOR_BUFFER_BIT);                                    // sky
    gl.useProgram(progViz);
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

  // ---- profiling primitive (spec §9). The engine owns measurement because it owns the GL passes; the
  // editor's profiler.js + UI orchestrate. hub.timed defaults to a passthrough (so frame() is unaffected in
  // the player build, where this whole module dead-strips); this swaps in real GPU timer queries. ----
    let instrumenting = false;
    const TIME_ELAPSED = 0x88BF, GPU_DISJOINT = 0x8FBB;   // EXT_disjoint_timer_query_webgl2 enums
    const tq = { bake:{q:[null,null], i:0}, transport:{q:[null,null], i:0} };
    hub.timed = (pass, draw) => {
      if(!instrumenting || !extTimer){ draw(); return; }
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
    // offscreen stress burst: render a pass n times into an off-screen RGBA8 target at the live backing size,
    // then readPixels one texel to fence — so wall-clock spans real GPU work uncapped by vsync (one synchronous
    // burst, not one-per-rAF). headroom = a 60fps frame budget / per-render ms. Works even where timer queries don't.
    function ensureBenchTarget(){
      // measure transport at MAX resolution (resScale=1), NOT the live auto-quality-trimmed backing — the
      // profiler exists to show the cost of each stylistic decision at full quality (spec §9), and on a weak
      // device the live canvas may already be downscaled, which would understate the true cost.
      const dpr=Math.min(2, window.devicePixelRatio||1);
      const w=Math.max(1,Math.round(canvas.clientWidth*dpr)), h=Math.max(1,Math.round(canvas.clientHeight*dpr));
      if(hub.benchFBO && benchW===w && benchH===h) return;
      if(hub.benchTex) gl.deleteTexture(hub.benchTex);
      if(!hub.benchFBO) hub.benchFBO=gl.createFramebuffer();
      hub.benchTex=gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, hub.benchTex);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, hub.benchFBO);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, hub.benchTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      benchW=w; benchH=h;
    }
    function bench(pass, n){
      n = Math.max(1, n|0);
      // fence the burst with gl.finish() (drains ALL queued GL work). The old readPixels fence was a RGBA/UNSIGNED_BYTE
      // read of an RGBA16F target (layerTex[0]) — an invalid combo that errors instead of flushing, and in faithful
      // mode bake() writes faithTex (layerTex[0] is a 1×1 dummy), so the fence read the wrong/unwritten texture. (E#35)
      if(pass==='transport'){
        ensureBenchTarget();
        const t0=performance.now();
        for(let i=0;i<n;i++) hub.drawFrameInto(hub.benchFBO, benchW, benchH);   // the whole frame, diffusion included — the tier's cost is the thing the axis measures
        gl.finish();
        const ms=(performance.now()-t0)/n;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { ms, headroom: 16.67/Math.max(ms,1e-3) };
      }
      if(pass==='bake'){
        const t0=performance.now();
        for(let i=0;i<n;i++) hub.bake();                            // bake targets its own layer/faith FBOs
        gl.finish();                                            // fence: drains the bake passes (layer or faithful)
        const ms=(performance.now()-t0)/n;
        return { ms, headroom: 16.67/Math.max(ms,1e-3) };
      }
      return { ms:0, headroom:Infinity };
    }
    hub.profiler = { hasTimer: !!extTimer, bakeMs:0, transportMs:0, setInstrument(on){ instrumenting=!!on; }, bench };

  // ---- motion mirror: drive this engine's wind EXACTLY from another instance instead of its own
  // physics, so the A/B picker's two engines animate in lockstep. Safe because the profiler's variants never
  // change the grove skeleton (tree/limb/branch/seed), so the spring arrays line up 1:1. Holds for faithful_canopy
  // too: flipping it keeps the same grown grove and spring arrays — only the cast path (layer vs per-sample bake)
  // changes — so the mirror stays sound for that axis as well. snapshotMotion exposes
  // live refs (read-only); applyMotion copies them in + re-uploads the bend texture; setMotionSource swaps the
  // per-frame tick for a copy-from-source. The bake only reads angles + sway + time, so velocities aren't needed. ----
    hub.snapshotMotion = () => ({ m:motion, dphase:params.drift_phase, lA:hub.hier?.limbAngle, lP:hub.hier?.limbPitch, tA:hub.hier?.twigAngle });
    hub.applyMotion = (s) => {
      if(!s) return;
      const sm=s.m;
      motion.time=sm.time; motion.u=sm.u; motion.v=sm.v; motion.uLat=sm.uLat; motion.vLat=sm.vLat;
      motion.env=sm.env; motion.driveEnv=sm.driveEnv; motion.windX=sm.windX; motion.windY=sm.windY; motion.weatherS=sm.weatherS;
      motion.sway[0]=sm.sway[0]; motion.sway[1]=sm.sway[1];
      params.drift_phase = s.dphase;                       // incoherent band rides a param the source advances
      if(hub.hier && s.lA && hub.hier.limbAngle.length===s.lA.length){
        hub.hier.limbAngle.set(s.lA); hub.hier.limbPitch.set(s.lP); hub.hier.twigAngle.set(s.tA);   // BOTH limb DOFs, or the wipe's two engines foreshorten differently
        hub.publishBend(hub.grove);                                // push the mirrored bend into the texture the bake reads
      }
    };
    hub.setMotionSource = (src) => { hub.motionTick = src ? () => hub.applyMotion(src.snapshotMotion()) : hub.tick; };
}
