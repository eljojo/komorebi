// ============================================================================
// The held leaf's inset (spec §4.5 "The held leaf", §9): DOM only. One canvas fixed at the bottom-left (the tree inset holds the bottom-right), showing ONE
// grown leaf of the grove against the sun with its areole maze at full resolution (leaf-maze.js does the physics; this draws it). Built on first show and
// never otherwise, so nothing exists until `L`; imported by editor.js alone.
//
// draw() runs from eng.onFrame and does nothing unless a signature moved, because the work has three prices: (seed, shape, size, address) REGROWS the maze;
// wall_fraction re-rasterises the masks; the pigment only recolours. The first two are ~0.5 s and never per frame — a signature that is still moving (a slider
// drag, a canopy morph lerping leaf_size_m every tick) is DEFERRED, not dropped: the picture keeps the last leaf it made until the inputs have stood still for
// SETTLE_MS, and then makes the one it was asked for. The recolour is cheap and follows the sliders live; the first draw after `L` has nothing to show and is at once.
//
// THE PICTURE IS THE LEAF IT WAS MADE FOR: while a regrow waits, the address, the seed, the size and the shape the label and the pigment read are the ones the maze
// on show was grown with (`made`), never the params' newer ones. The leaf's TREE is read the same way: the tree the grove hangs cluster `made.j` on (hierOf, the grove the engine holds), and its lead and
// depth are drawn from `made.seed` — the knobs' values are the live ones, so they recolour with the sliders like the pigments, but never from the params' seed or address, which run ahead of the picture.
//
// STACKING: the controls win. The canvas is positioned and has no z-index on purpose, so it stacks by DOM order — it sits right after the art canvas (a positioned
// element over a plain one) and before #dev, #play and everything else, and the strip's z-index 8 puts the strip above it too. It stops click and pointer events only on itself.
// ============================================================================
import { TAU_ANTHOCYANIN, TAU_CAROTENOID, TAU_TANNIN, leafClock, senescence, treeGains, treeShifts } from './komorebi-math.js';
import { LEAF_SHAPES, MAPLE } from './komorebi-leaf.js';
import { leafMaze, paintLeaf, rasterLeaf, tissues } from './leaf-maze.js';

const N = 512;   // the raster's side: a regrow + raster costs ~0.5 s in bun, once per settled change of leaf, never per frame
const SETTLE_MS = 250;   // how long a regrow's or a re-raster's inputs must have stood still (performance.now()) before it is paid
const PIGMENT_KEYS = ['phenology', 'turn_start', 'turn_span', 'turn_spread', 'turn_exposure', 'anthocyanin', 'tannin', 'trans_r', 'trans_g', 'trans_b', 'drop_after_turn', 'tree_clock_spread', 'tree_pigment_spread'];

// hierOf() is the grove the engine holds (its `hier`): [ / ] walk what it hung, so they read its counts and never rebuild them from the params
function makeLeafPreview(params, hierOf){
  const canvas = document.createElement('canvas');
  canvas.id = 'leaf';
  Object.assign(canvas.style, { position: 'fixed', left: '10px', bottom: '10px', background: '#000', borderRadius: '4px', cursor: 'zoom-in', display: 'none' });
  const art = document.getElementById('gl');
  if(art) art.after(canvas); else document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d'), buf = document.createElement('canvas'), bctx = buf.getContext('2d');
  buf.width = buf.height = N;
  let big = false, j = 0, k = 0, shown = false, label = '', grown = null, raster = null, tint = null, made = null, grows = 0, rasters = 0;
  let sigGrow = '', sigRaster = null, sigPaint = '', sigSize = '';
  let seenGrow = '', seenGrowAt = 0, seenRaster = null, seenRasterAt = 0;   // what draw() last saw of the two expensive signatures, and when each last moved
  canvas.dataset.at = '0·0';   // the address the keys hold now; data-label / -size / -grammar / -wall are what the picture on show was made with (the grammar its veins were grown in: palmate for a maple, pinnate for a beech), and -grows / -rasters count the makes (test-gl/editor.mjs reads them)
  const sizeCss = () => (big ? 'min(80vh, 70vw)' : 'min(420px, 45vh)');
  // a click grows it and shrinks it again; it must not reach the canvas's gesture handlers (orbit, the tree's pin) beneath
  for(const ev of ['click', 'pointerdown', 'pointerup']) canvas.addEventListener(ev, (e) => e.stopPropagation());
  canvas.addEventListener('click', () => { big = !big; canvas.style.cursor = big ? 'zoom-out' : 'zoom-in'; });

  const spec = () => LEAF_SHAPES[params.leaf_shape] ?? MAPLE;
  function show(on){
    shown = on;
    canvas.style.display = on ? 'block' : 'none';
    if(!on){ sigGrow = sigPaint = sigSize = ''; sigRaster = null; seenGrow = ''; seenRaster = null; grown = raster = null; }   // the next show redraws whatever moved while it was away, at once
  }
  // what the grove hung: how many clusters it grew and how many leaves are on each (the marginal leaf counted only where there is one). The grove's own record, so an address
  // the grove does not have is never reached, and a look change that shrinks it pulls the address back in
  function fit(){
    const h = hierOf?.(), clusters = Math.max(1, h?.nClusterTotal ?? 1), leaves = Math.max(1, h?.nLeaf ?? 1);
    j = Math.min(j, clusters - 1); k = Math.min(k, leaves - 1);
    return { clusters, leaves };
  }
  // [ / ]: one ring through every leaf the grove hangs, cluster after cluster, wrapping at both ends
  function step(dir){
    const { clusters, leaves } = fit(), ring = clusters*leaves, at = (((j*leaves + k + dir) % ring) + ring) % ring;
    j = Math.floor(at/leaves); k = at % leaves;
    canvas.dataset.at = `${j}·${k}`;
  }
  function draw(){
    if(!shown) return;
    fit();
    canvas.dataset.at = `${j}·${k}`;
    const now = performance.now(), css = sizeCss();
    if(css !== sigSize){ canvas.style.width = canvas.style.height = css; sigSize = css; sigPaint = ''; }
    const px = Math.max(64, Math.round(canvas.clientWidth*(window.devicePixelRatio || 1)));
    const sg = `${params.seed}|${params.leaf_shape}|${params.leaf_size_m}|${j}|${k}`;
    if(sg !== seenGrow){ seenGrow = sg; seenGrowAt = now; }
    let regrown = false;
    if(sg !== sigGrow && (!grown || now - seenGrowAt >= SETTLE_MS)){
      made = { seed: params.seed, shape: params.leaf_shape, size: params.leaf_size_m, j, k };
      grown = leafMaze(spec(), made.seed, made.j, made.k, made.size); sigGrow = sg; regrown = true;
      canvas.dataset.grows = String(++grows); canvas.dataset.size = String(made.size); canvas.dataset.grammar = grown.blade.grammar;
    }
    if(params.wall_fraction !== seenRaster){ seenRaster = params.wall_fraction; seenRasterAt = now; }
    if(regrown || (params.wall_fraction !== sigRaster && (!raster || now - seenRasterAt >= SETTLE_MS))){   // a new maze has no raster to show: that one is at once, even at the same vein share (the old raster is the old leaf's maze)
      raster = rasterLeaf(grown.blade, grown.maze, params.wall_fraction, N); sigRaster = params.wall_fraction; sigPaint = '';
      canvas.dataset.rasters = String(++rasters); canvas.dataset.wall = String(sigRaster);
    }
    const tree = hierOf?.()?.twigs?.[made.j]?.tree ?? 0;   // the tree this leaf's cluster hangs on, in the grove on screen
    const pg = `${PIGMENT_KEYS.map((q) => params[q]).join('|')}|${sigGrow}|${sigRaster}|${tree}`;
    if(pg !== sigPaint){
      const mine = { ...params, seed: made.seed }, dT = treeShifts(mine, tree + 1)?.[tree], cT = treeGains(mine, tree + 1)?.[tree];   // the tree's lead and depth, at the leaf's own seed; absent while a knob is 0
      tint = tissues(params, made.seed, made.j, made.k, dT, cT);
      bctx.putImageData(new ImageData(paintLeaf(raster, tint.wall, tint.cell), N, N), 0, 0);
      sigPaint = pg;
      // the leaf's own state, read back from its two tissues (the pigment law stays leafTau's): s from its clock, a and b from how far the tissues part
      const s = senescence(params, leafClock(made.seed, made.j, made.k), dT), a = s > 0 ? (tint.cell[1] - tint.wall[1])/(s*TAU_ANTHOCYANIN[1]) : 0;
      const b = s > 0 && params.tannin > 0 ? (tint.wall[0] - tint.summer[0]*(1 - s) - s*TAU_CAROTENOID[0])/(s*TAU_TANNIN[0]) : 0;
      const ofTree = dT !== undefined || cT !== undefined ? ` · tree ${tree}${dT !== undefined ? ` Δ ${dT.toFixed(3)}` : ''}${cT !== undefined ? ` c ${cT.toFixed(2)}` : ''}` : '';   // what the tree did to this leaf, when a knob is up
      label = `leaf ${made.j}·${made.k} · outline ${grown.variant} · s ${s.toFixed(2)} a ${a.toFixed(2)} b ${b.toFixed(2)}${ofTree}`;
      canvas.dataset.label = label;
    }
    if(canvas.width !== px || canvas.height !== px){ canvas.width = canvas.height = px; }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(buf, 0, 0, px, px);
    // overlays: 1 cm in the picture's own scale (the view spans 2·half units of the size it was grown at, /2), the address, and what the engine does NOT show
    const unitPx = px/(2*raster.view.half), cmPx = 0.01/(made.size/2)*unitPx, u = px/420, pad = 10*u;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2*u; ctx.font = `${11*u}px ui-monospace,Menlo,monospace`;
    ctx.beginPath(); ctx.moveTo(pad, px - pad); ctx.lineTo(pad + cmPx, px - pad); ctx.stroke();
    ctx.fillText('1 cm', pad, px - pad - 5*u);
    ctx.fillText(label, pad, 16*u);
    const note = LEAF_SHAPES[made.shape] ? '' : '(the engine draws the ellipse) ';
    ctx.fillText(`${note}at the leaf's own clock: no exposure order`, pad, 30*u);
    // the grove gives each leaf 0.6-1.4x the look's leaf_size_m from its arrangement stream; replaying that stream here would couple the two, so the picture says what it is
    ctx.fillText(`nominal ${(made.size*100).toFixed(1)} cm; the grove draws 0.6–1.4× of it`, pad, 44*u);
  }
  return { canvas, draw, show, step, get shown(){ return shown; } };
}

export { makeLeafPreview };
