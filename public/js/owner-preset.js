// The owner's controls on /p/:id. Each one is a call to the same API an agent would make.
import { failure, send } from './api.js';
import { el, say } from './dom.js';
import { readLook, versionBody } from './paste.js';

const box = document.getElementById('owner-controls');
box.hidden = false;
const id = box.dataset.preset;

box.querySelector('[name="visibility"]').addEventListener('change', async (event) => {
  const r = await send('PATCH', `/api/presets/${id}`, { visibility: event.target.value });
  if (r.ok) location.reload();
  else say(box, failure(r));
});

for (const action of ['archive', 'unarchive']) {
  document.getElementById(action)?.addEventListener('click', async () => {
    const r = await send('POST', `/api/presets/${id}/${action}`);
    if (r.ok) location.reload();
    else say(box, failure(r));
  });
}

const versionForm = document.querySelector('#new-version form');
versionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const look = readLook(versionForm.elements.params.value);
  if (!look.ok) return say(box, look.message);
  const r = await send('POST', `/api/presets/${id}/versions`, versionBody(look.paramsText));
  if (r.ok) location.reload();
  else say(box, failure(r));
});

const addForm = document.querySelector('#add-to-playlist form');
const pick = addForm.elements.playlist;
const newName = addForm.elements.name;
const NEW = 'new';

// The person's playlists are fetched when the section is first opened.
document.getElementById('add-to-playlist').addEventListener(
  'toggle',
  async () => {
    const r = await send('GET', '/api/playlists?owner=me');
    if (!r.ok) return say(box, failure(r));
    pick.replaceChildren(...r.data.playlists.map((l) => el('option', { value: l.id, textContent: l.name })), el('option', { value: NEW, textContent: 'a new playlist…' }));
    newName.hidden = pick.value !== NEW;
  },
  { once: true },
);
pick.addEventListener('change', () => (newName.hidden = pick.value !== NEW));

addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  let listId = pick.value;
  if (listId === NEW) {
    const made = await send('POST', '/api/playlists', { name: newName.value });
    if (!made.ok) return say(box, failure(made));
    listId = made.data.id;
  }
  const list = await send('GET', `/api/playlists/${listId}`);
  if (!list.ok) return say(box, failure(list));
  const items = list.data.items.map(({ preset_id, dwell_s, crossfade_s }) => ({ preset_id, dwell_s, crossfade_s }));
  items.push({ preset_id: Number(id) });
  const put = await send('PUT', `/api/playlists/${listId}/items`, { items });
  if (!put.ok) return say(box, failure(put));
  box.querySelector('.msg').replaceChildren('added to ', el('a', { href: `/l/${listId}`, textContent: put.data.name }));
});
