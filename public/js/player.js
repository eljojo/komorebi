// The inline playlist player (spec §6): one canvas that steps through the visible items in order, looping.
import { loadEngine } from './engine.js';
import { arrive, playable } from './queue.js';

const canvas = document.getElementById('player');

async function mount() {
  // The owner's list also holds rows for items that are unavailable now; they are skipped here as in the data.
  const rows = [...document.querySelectorAll('#items > li:not([data-unavailable])')];
  try {
    const [res, Komorebi] = await Promise.all([fetch(canvas.dataset.src), loadEngine(canvas.dataset.engine)]);
    if (!res.ok) throw new Error('the playlist could not be loaded');
    const items = playable((await res.json()).items);
    if (!items.length) throw new Error('nothing to play');

    const engine = Komorebi.create(canvas, { params: items[0].params });
    let at = 0;
    let timer;

    const mark = () => rows.forEach((row, i) => (i === at ? row.setAttribute('aria-current', 'true') : row.removeAttribute('aria-current')));

    // The transition into an item takes that item's crossfade; it holds for its own dwell before the next step.
    const step = (to) => {
      const arrival = arrive(items, to);
      at = arrival.at;
      engine.transitionTo(items[at].params, { duration: arrival.duration });
      mark();
      schedule();
    };
    const schedule = () => {
      clearTimeout(timer);
      if (items.length > 1) timer = setTimeout(() => step(at + 1), items[at].dwell_s * 1000);
    };

    document.getElementById('prev').addEventListener('click', () => step(at - 1));
    document.getElementById('next').addEventListener('click', () => step(at + 1));
    mark();
    schedule();
  } catch {
    // No WebGL2 (spec §7), or nothing to play: the page stays a plain list.
    canvas.closest('figure').remove();
  }
}

if (canvas) mount();
