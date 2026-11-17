// The garden's one player. The entries beside it are plain linked text; resting on one (the pointer settling, the
// keyboard focusing it, a tap on its body) moves the player to that look with the engine's own crossfade, slowly.
import { loadEngine } from './engine.js';
import { fullscreenOnDoubleClick, toggleFullscreen } from './fullscreen.js';

const root = document.getElementById('garden');

const FADE_S = 3;       // an unhurried crossfade between looks
const SETTLE_MS = 350;  // the pointer must rest this long on an entry before the light follows it

async function mount() {
  const canvas = root.querySelector('canvas');
  const entries = [...root.querySelectorAll('.look')];
  const params = new Map();   // entry -> the promise of its params, fetched once

  const paramsOf = (entry) => {
    if (!params.has(entry)) {
      const loading = fetch(entry.dataset.src).then((res) => {
        if (!res.ok) throw new Error('the look could not be loaded');
        return res.json();
      }).then((body) => body.params);
      loading.catch(() => params.delete(entry));   // a failed fetch may be tried again
      params.set(entry, loading);
    }
    return params.get(entry);
  };

  try {
    const [first, Komorebi] = await Promise.all([paramsOf(entries[0]), loadEngine(canvas.dataset.engine)]);
    const engine = Komorebi.create(canvas, { params: first });
    document.addEventListener('visibilitychange', () => engine.setPaused(document.hidden));
    fullscreenOnDoubleClick(canvas);

    let shown = 0;    // the look the player is on
    let wanted = 0;   // the look the visitor last rested on
    let timer;
    const mark = () => entries.forEach((entry, i) => (i === shown ? entry.setAttribute('aria-current', 'true') : entry.removeAttribute('aria-current')));

    async function go(i) {
      wanted = i;
      if (i === shown) return;
      try {
        const next = await paramsOf(entries[i]);
        if (wanted !== i) return;   // the visitor has moved on while it loaded
        engine.transitionTo(next, { duration: FADE_S });
        shown = i;
        mark();
      } catch {
        // that look cannot be had; the player stays where it is
      }
    }

    // Only where the pointer settles counts: leaving cancels, so sweeping across the list queues nothing.
    const settle = (i) => {
      clearTimeout(timer);
      timer = setTimeout(() => go(i), SETTLE_MS);
    };
    entries.forEach((entry, i) => {
      entry.addEventListener('mouseenter', () => settle(i));
      entry.addEventListener('mouseleave', () => clearTimeout(timer));
      entry.addEventListener('focusin', () => settle(i));
      // A tap on the entry's body, not on one of its links, selects it at once.
      entry.addEventListener('click', (event) => {
        if (event.target.closest('a')) return;
        clearTimeout(timer);
        go(i);
      });
      // A double-click on it takes the player fullscreen, on that look (José, 2026-10-10), as a double-click on the player does.
      entry.addEventListener('dblclick', (event) => {
        if (event.target.closest('a')) return;
        clearTimeout(timer);
        go(i);
        toggleFullscreen(document, canvas);
      });
    });
    mark();
  } catch {
    // No WebGL2 (spec §7), or the first look would not load: the player goes and the list stays.
    canvas.closest('figure').remove();
  }
}

if (root) mount();
