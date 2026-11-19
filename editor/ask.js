// ============================================================================
// QUESTIONS ASKED IN THE PAGE (EDITOR-only): a name, a yes or no, a word to read, each in a <dialog> of the page's own.
// The browser's prompt(), confirm() and alert() over a fullscreen page make Safari leave fullscreen and leave the tab broken;
// a modal dialog is drawn in the page's top layer, over a fullscreen picture, and leaves it where it is.
// Every question answers through a promise: the text (null when cancelled), true or false, or nothing once read.
// ============================================================================

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

// One dialog: `fill(form)` lays the question into the form and returns what a confirmed answer reads back. The confirming button
// comes first in the form, so Enter in a field picks it; the CSS lays it last.
function ask(fill, { ok, cancel }) {
  return new Promise((resolve) => {
    const d = el('dialog', 'ask'), f = el('form');
    f.method = 'dialog';
    const answer = fill(f);
    const acts = el('div', 'acts');
    const yes = el('button', 'ok on', ok); yes.value = 'ok';                     // lit: the answer the question expects
    acts.append(yes);
    if (cancel) { const no = el('button', 'cancel', cancel); no.value = 'cancel'; no.type = 'submit'; acts.append(no); }
    f.append(acts); d.append(f);
    let result = null;
    f.addEventListener('submit', (e) => { if (e.submitter?.value === 'ok') result = answer(); });
    d.addEventListener('close', () => { d.remove(); resolve(result); });
    document.body.append(d);
    d.showModal();
  });
}

// A line of text (or a block, with `long`): the text as typed, or null.
export function askText(question, value = '', { ok = 'ok', cancel = 'cancel', long = false } = {}) {
  return ask((f) => {
    const field = long ? el('textarea') : el('input');
    if (!long) field.type = 'text';
    field.value = value; field.setAttribute('aria-label', question);
    field.autocomplete = 'off'; field.spellcheck = false;
    f.append(el('p', 'q', question), field);
    queueMicrotask(() => { field.focus(); field.select(); });
    return () => field.value;
  }, { ok, cancel });
}

// A yes or no: true only on `yes`.
export async function askYes(question, { yes = 'yes', no = 'cancel' } = {}) {
  return (await ask((f) => { f.append(el('p', 'q', question)); return () => true; }, { ok: yes, cancel: no })) === true;
}

// Something to read, and one button to close it.
export async function tell(text, { ok = 'ok' } = {}) {
  await ask((f) => { f.append(el('p', 'q', text)); return () => true; }, { ok, cancel: null });
}
