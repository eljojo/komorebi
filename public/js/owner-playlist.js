// The owner's controls on /arboretum/l/:id: visibility, and the list itself (reorder, remove, dwell, crossfade, and how each look arrives).
import { failure, send } from './api.js';
import { el, say } from './dom.js';

const box = document.getElementById('owner-controls');
box.hidden = false;
const id = box.dataset.playlist;
const list = document.getElementById('items');
box.querySelector('[name="presentation"]').addEventListener('change',async event=>{
  const r=await send('PATCH',`/api/playlists/${id}`,{presentation:event.target.value || null,revision:Number(box.dataset.revision)});
  if(r.ok)location.reload();else say(box,failure(r));
});

box.querySelector('[name="visibility"]').addEventListener('change', async (event) => {
  const r = await send('PATCH', `/api/playlists/${id}`, { visibility: event.target.value });
  if (r.ok) location.reload();
  else say(box, failure(r));
});

const number = (value, min, max) => el('input', { type: 'number', value, min, max, step: 'any', required: true });

for (const row of list.children) {
  const dwell = number(row.dataset.dwell, 1, 3600);
  const crossfade = number(row.dataset.crossfade, 0, 120);
  dwell.className = crossfade.className = 'seconds';
  // How this item's look arrives when the playlist plays: the engine's own route, or a dissolve of the two scenes.
  const style = el('select', {}, ...['morph', 'fade'].map((value) => el('option', { value, textContent: value, selected: value === row.dataset.style })));
  row.querySelector('.when').replaceWith(
    el('span', { className: 'controls' },
      el('label', {}, 'dwell ', dwell, ' s'),
      el('label', {}, 'crossfade ', crossfade, ' s'),
      el('label', {}, 'arrives by ', style),
      el('button', { type: 'button', textContent: 'up', onclick: () => row.previousElementSibling?.before(row) }),
      el('button', { type: 'button', textContent: 'down', onclick: () => row.nextElementSibling?.after(row) }),
      el('button', { type: 'button', textContent: 'remove', onclick: () => row.remove() })),
  );
  row.fields = { dwell, crossfade, style };
}

document.getElementById('save-items').addEventListener('click', async () => {
  const items = [...list.children].map((row) => ({
    preset_id: Number(row.dataset.preset),
    dwell_s: Number(row.fields.dwell.value),
    crossfade_s: Number(row.fields.crossfade.value),
    style: row.fields.style.value,
  }));
  const r = await send('PUT', `/api/playlists/${id}/items`, { revision: Number(box.dataset.revision), items });
  if (r.ok) location.reload();
  else say(box, failure(r));
});
