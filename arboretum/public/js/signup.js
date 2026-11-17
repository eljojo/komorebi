import { failure, send } from './api.js';
import { BASE } from './base.js';
import { say } from './dom.js';

const { startRegistration, browserSupportsWebAuthn } = window.SimpleWebAuthnBrowser;
const form = document.getElementById('signup');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!browserSupportsWebAuthn()) return say(form, 'this browser cannot make a passkey');
  say(form, '');

  const options = await send('POST', '/api/auth/register-options', { username: form.elements.username.value });
  if (!options.ok) return say(form, failure(options));

  let credential;
  try {
    credential = await startRegistration({ optionsJSON: options.data });
  } catch (err) {
    return say(form, `the passkey was not made: ${err.message}`);
  }
  const done = await send('POST', '/api/auth/register', { credential });
  if (!done.ok) return say(form, failure(done));
  location.assign(BASE);
});
