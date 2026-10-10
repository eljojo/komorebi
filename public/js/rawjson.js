// The exact text of one top-level member of a JSON object, as the sender wrote it.
//
// Params are stored verbatim (spec §2.3), and `JSON.stringify(JSON.parse(x))` is a rewrite: it turns `1.0` into
// `1` and drops the sender's whitespace. So the text is cut out of the request body instead.
// The caller has already run JSON.parse on `text`, so it is a valid object and this does not re-validate.
// One copy serves both ends: the Worker cuts params out of a request body, and the pages cut them out of a paste.

// Calls `visit(name, valueText)` for each top-level member of the object in `text`, in order, repeats included.
/**
 * @param {string} text
 * @param {(name: string, value: string) => void} visit
 */
function eachMember(text, visit) {
  let i = 0;
  const skipSpace = () => {
    while (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r') i++;
  };
  const skipString = () => {
    i++;
    while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
  };
  const skipValue = () => {
    const first = text[i];
    if (first === '"') return skipString();
    if (first === '{' || first === '[') {
      let depth = 0;
      do {
        const ch = text[i];
        if (ch === '"') {
          skipString();
          continue;
        }
        if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') depth--;
        i++;
      } while (depth > 0);
      return;
    }
    while (i < text.length && !',}] \t\n\r'.includes(text[i])) i++;
  };

  skipSpace();
  i++; // the opening brace
  for (;;) {
    skipSpace();
    if (text[i] === '}') return;
    const keyStart = i;
    skipString();
    const name = JSON.parse(text.slice(keyStart, i));
    skipSpace();
    i++; // the colon
    skipSpace();
    const valueStart = i;
    skipValue();
    visit(name, text.slice(valueStart, i));
    skipSpace();
    if (text[i] === ',') i++;
  }
}

/**
 * @param {string} text
 * @param {string} key
 * @returns {string | undefined}
 */
export function rawMember(text, key) {
  /** @type {string | undefined} */
  let found;
  // A duplicate key: JSON.parse keeps the last, so this does too.
  eachMember(text, (name, value) => {
    if (name === key) found = value;
  });
  return found;
}

// The top-level keys the object text spells more than once. JSON.parse keeps only the last copy, so the earlier
// ones would be stored (verbatim, spec §2.3) without ever being validated.
/**
 * @param {string} text
 * @returns {string[]}
 */
export function duplicateKeys(text) {
  const seen = new Set();
  const repeated = new Set();
  eachMember(text, (name) => (seen.has(name) ? repeated.add(name) : seen.add(name)));
  return [...repeated];
}
