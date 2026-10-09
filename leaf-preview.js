// ============================================================================
// The held leaf's inset (spec §4.5 "The held leaf", §9): DOM only. One canvas fixed at the bottom-left (the tree inset holds the bottom-right), showing ONE
// grown leaf of the grove against the sun with its areole maze at full resolution (leaf-maze.js does the physics; this draws it). Built on first show and
// never otherwise, so nothing exists until `L`; imported by editor.js alone.
//
// draw() runs from eng.onFrame and does nothing unless a signature moved, because the work has three prices: (seed, shape, size, address) REGROWS the maze;
// wall_fraction re-rasterises the masks; the pigment only recolours.
// ============================================================================
import { TAU_ANTHOCYANIN, TAU_CAROTENOID, TAU_TANNIN, leafClock, senescence } from './komorebi-math.js';
import { LEAF_SHAPES, MAPLE } from './komorebi-leaf.js';
import { leafMaze, paintLeaf, rasterLeaf, tissues } from './leaf-maze.js';

const N = 512;   // the raster's side: a regrow + raster costs ~0.5 s in bun, once per change of leaf, never per frame
const PIGMENT_KEYS = ['phenology', 'turn_start', 'turn_span', 'turn_spread', 'turn_exposure', 'anthocyanin', 'tannin', 'trans_r', 'trans_g', 'trans_b', 'drop_after_turn'];

function makeLeafPreview(params){
  const canvas = document.createElement('canvas');
  canvas.id = 'leaf';
  Object.assign(canvas.style, { position: 'fixed', left: '10px', bottom: '10px', zIndex: '9', background: '#000', borderRadius: '4px', cursor: 'zoom-in', display: 'none' });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d'), buf = document.createElement('canvas'), bctx = buf.getContext('2d');
  buf.width = buf.height = N;
  let big = false, j = 0, k = 0, shown = false, label = '', grown = null, raster = null, tint = null;
  let sigGrow = '', sigRaster = '', sigPaint = '', sigSize = '';
  const sizeCss = () => (big ? 'min(80vh, 70vw)' : 'min(420px, 45vh)');
  // a click grows it and shrinks it again; it must not reach the canvas's gesture handlers (orbit, the tree's pin) beneath
  for(const ev of ['click', 'pointerdown', 'pointerup']) canvas.addEventListener(ev, (e) => e.stopPropagation());
  canvas.addEventListener('click', () => { big = !big; canvas.style.cursor = big ? 'zoom-out' : 'zoom-in'; });

  const spec = () => LEAF_SHAPES[params.leaf_shape] ?? MAPLE;
  function show(on){
    shown = on;
    canvas.style.display = on ? 'block' : 'none';
    if(!on){ sigGrow = sigRaster = sigPaint = sigSize = ''; }   // the next show redraws whatever moved while it was away
  }
  // [ / ]: the next leaf of the cluster, wrapping into the next cluster at leaves_per_cluster
  function step(dir){
    const per = Math.max(1, Math.round(params.leaves_per_cluster));
    k += dir;
    if(k >= per){ k = 0; j++; }
    else if(k < 0){ if(j > 0){ j--; k = per - 1; } else k = 0; }
  }
  function draw(){
    if(!shown) return;
    const css = sizeCss();
    if(css !== sigSize){ canvas.style.width = canvas.style.height = css; sigSize = css; sigPaint = ''; }
    const px = Math.max(64, Math.round(canvas.clientWidth*(window.devicePixelRatio || 1)));
    const sg = `${params.seed}|${params.leaf_shape}|${params.leaf_size_m}|${j}|${k}`;
    if(sg !== sigGrow){ grown = leafMaze(spec(), params.seed, j, k, params.leaf_size_m); sigGrow = sg; sigRaster = ''; }
    if(params.wall_fraction !== sigRaster){ raster = rasterLeaf(grown.blade, grown.maze, params.wall_fraction, N); sigRaster = params.wall_fraction; sigPaint = ''; }
    const pg = `${PIGMENT_KEYS.map((q) => params[q]).join('|')}|${sg}|${sigRaster}`;
    if(pg !== sigPaint){
      tint = tissues(params, params.seed, j, k);
      bctx.putImageData(new ImageData(paintLeaf(raster, tint.wall, tint.cell), N, N), 0, 0);
      sigPaint = pg;
      // the leaf's own state, read back from its two tissues (the pigment law stays leafTau's): s from its clock, a and b from how far the tissues part
      const s = senescence(params, leafClock(params.seed, j, k)), a = s > 0 ? (tint.cell[1] - tint.wall[1])/(s*TAU_ANTHOCYANIN[1]) : 0;
      const b = s > 0 && params.tannin > 0 ? (tint.wall[0] - tint.summer[0]*(1 - s) - s*TAU_CAROTENOID[0])/(s*TAU_TANNIN[0]) : 0;
      label = `leaf ${j}·${k} · outline ${grown.variant} · s ${s.toFixed(2)} a ${a.toFixed(2)} b ${b.toFixed(2)}`;
      canvas.dataset.label = label;
    }
    if(canvas.width !== px || canvas.height !== px){ canvas.width = canvas.height = px; }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(buf, 0, 0, px, px);
    // overlays: 1 cm in the picture's own scale (the view spans 2·half units of leaf_size_m/2), the address, and what the engine does NOT show
    const unitPx = px/(2*raster.view.half), cmPx = 0.01/(params.leaf_size_m/2)*unitPx, u = px/420, pad = 10*u;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2*u; ctx.font = `${11*u}px ui-monospace,Menlo,monospace`;
    ctx.beginPath(); ctx.moveTo(pad, px - pad); ctx.lineTo(pad + cmPx, px - pad); ctx.stroke();
    ctx.fillText('1 cm', pad, px - pad - 5*u);
    ctx.fillText(label, pad, 16*u);
    const note = LEAF_SHAPES[params.leaf_shape] ? '' : '(the engine draws the ellipse) ';
    ctx.fillText(`${note}at the leaf's own clock: no exposure order`, pad, 30*u);
  }
  return { canvas, draw, show, step, get shown(){ return shown; } };
}

export { makeLeafPreview };
