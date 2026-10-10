import { failure, send } from './api.js';
import { say } from './dom.js';

const { startAuthentication, browserSupportsWebAuthn } = window.SimpleWebAuthnBrowser;
const button = document.getElementById('login');
const page = document.querySelector('main');

button.addEventListener('click', async () => {
  if (!browserSupportsWebAuthn()) return say(page, 'this browser cannot use a passkey');
  say(page, '');

  const options = await send('POST', '/api/auth/login-options');
  if (!options.ok) return say(page, failure(options));

  let credential;
  try {
    credential = await startAuthentication({ optionsJSON: options.data });
  } catch (err) {
    return say(page, `no passkey was used: ${err.message}`);
  }
  const done = await send('POST', '/api/auth/login', { credential });
  if (!done.ok) return say(page, failure(done));
  location.assign('/');
});
