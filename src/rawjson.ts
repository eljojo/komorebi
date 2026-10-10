// The exact text of one top-level member of a JSON object, as the sender wrote it.
//
// Params are stored verbatim (spec §2.3), and `JSON.stringify(JSON.parse(x))` is a rewrite: it turns `1.0` into
// `1` and drops the sender's whitespace. So the text is cut out of the request body instead.
// The caller has already run JSON.parse on `text`, so it is a valid object and this does not re-validate.
export function rawMember(text: string, key: string): string | undefined {
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
  let found: string | undefined;
  for (;;) {
    skipSpace();
    if (text[i] === '}') return found;
    const keyStart = i;
    skipString();
    const name = JSON.parse(text.slice(keyStart, i)) as string;
    skipSpace();
    i++; // the colon
    skipSpace();
    const valueStart = i;
    skipValue();
    // A duplicate key: JSON.parse keeps the last, so this does too.
    if (name === key) found = text.slice(valueStart, i);
    skipSpace();
    if (text[i] === ',') i++;
  }
}
