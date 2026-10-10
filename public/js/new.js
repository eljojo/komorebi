import { failure, send } from './api.js';
import { say } from './dom.js';
import { createBody, readLook } from './paste.js';

const form = document.getElementById('new');
const file = form.querySelector('input[type="file"]');

file.addEventListener('change', async () => {
  if (file.files[0]) form.elements.params.value = await file.files[0].text();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const look = readLook(form.elements.params.value);
  if (!look.ok) return say(form, look.message);
  const body = createBody(look.paramsText, {
    name: form.elements.name.value,
    description: form.elements.description.value,
    tags: [...form.querySelectorAll('input[name="tags"]:checked')].map((box) => box.value),
    visibility: form.elements.visibility.value,
  });
  const r = await send('POST', '/api/presets', body);
  if (!r.ok) return say(form, failure(r));
  location.assign(`/p/${r.data.id}`);
});
