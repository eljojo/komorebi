// One look, one canvas. create() runs the legacy-key migration itself, so the params go in as they were stored.
import { loadEngine } from './engine.js';
import { fullscreenOnDoubleClick } from './fullscreen.js';

const canvas = document.getElementById('preview');

async function mount() {
  try {
    const [res, Komorebi] = await Promise.all([fetch(canvas.dataset.src), loadEngine(canvas.dataset.engine)]);
    if (!res.ok) throw new Error('the look could not be loaded');
    const { params } = await res.json();
    Komorebi.create(canvas, { params });
    fullscreenOnDoubleClick(canvas);
  } catch {
    // Without WebGL2 create() throws (spec §7): the canvas goes and the page stays a plain, readable page.
    canvas.closest('figure').remove();
  }
}

if (canvas) mount();
