import { failure, send } from './api.js';
import { day, el, say } from './dom.js';

const { startRegistration } = window.SimpleWebAuthnBrowser;
const passkeys = document.getElementById('passkeys');
const tokens = document.getElementById('tokens');

async function showPasskeys() {
  const r = await send('GET', '/api/auth/passkeys');
  if (!r.ok) return say(passkeys, failure(r));
  passkeys.querySelector('ul').replaceChildren(
    ...r.data.passkeys.map((p) =>
      el('li', {},
        `added ${day(p.created_at)}, last used ${day(p.last_used_at)} `,
        el('button', {
          type: 'button',
          textContent: 'remove',
          onclick: async () => {
            const gone = await send('POST', `/api/auth/passkeys/${encodeURIComponent(p.id)}/remove`);
            // Removing a passkey signs the user out everywhere, this tab included.
            if (gone.ok) location.assign('/login');
            else say(passkeys, failure(gone));
          },
        }))),
  );
}

document.getElementById('add-passkey').addEventListener('click', async () => {
  say(passkeys, '');
  const options = await send('POST', '/api/auth/add-passkey-options');
  if (!options.ok) return say(passkeys, failure(options));
  let credential;
  try {
    credential = await startRegistration({ optionsJSON: options.data });
  } catch (err) {
    return say(passkeys, `the passkey was not made: ${err.message}`);
  }
  const done = await send('POST', '/api/auth/add-passkey', { credential });
  if (!done.ok) return say(passkeys, failure(done));
  showPasskeys();
});

async function showTokens() {
  const r = await send('GET', '/api/tokens');
  if (!r.ok) return say(tokens, failure(r));
  tokens.querySelector('ul').replaceChildren(
    ...r.data.tokens.map((t) =>
      el('li', {},
        `${t.label} · ${t.scope} · made ${day(t.created_at)}, last used ${day(t.last_used_at)} `,
        el('button', {
          type: 'button',
          textContent: 'revoke',
          onclick: async () => {
            const gone = await send('DELETE', `/api/tokens/${t.id}`);
            if (gone.ok) showTokens();
            else say(tokens, failure(gone));
          },
        }))),
  );
}

const mint = tokens.querySelector('form');
mint.addEventListener('submit', async (event) => {
  event.preventDefault();
  say(tokens, '');
  const r = await send('POST', '/api/tokens', { label: mint.elements.label.value, scope: mint.elements.scope.value });
  if (!r.ok) return say(tokens, failure(r));
  // Shown here once; the server keeps only a hash.
  const minted = document.getElementById('minted');
  minted.querySelector('code').textContent = r.data.token;
  minted.hidden = false;
  mint.reset();
  showTokens();
});

document.getElementById('logout').addEventListener('click', async () => {
  const r = await send('POST', '/api/auth/logout');
  if (r.ok) location.assign('/');
  else say(passkeys, failure(r));
});

showPasskeys();
showTokens();
