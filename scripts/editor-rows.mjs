// Reads the knob rows out of komorebi's editor.js (spec §5, brief 07). editor.js is a DOM module and can't be
// imported, so its PANEL table is read as text. Pure on purpose (no `node:` imports): a test imports it.
// Nothing here evaluates the source: row values go through a small literal parser, and a name is read only from
// the constants the caller hands in (MAX_LAYERS, from the archived komorebi-params.js).

// Index of the bracket closing the one at `open`, skipping strings, template literals and comments, so a quote or
// a bracket in a comment or a button's arrow function can't throw the count off.
function closing(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      for (i++; src[i] !== c; i++) {
        if (i >= src.length) throw new Error('editor.js: unterminated string');
        if (src[i] === '\\') i++;
      }
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2);
      if (i < 0) throw new Error('editor.js: unterminated comment');
      i++;
    } else if (c === '[' || c === '(' || c === '{') {
      depth++;
    } else if (c === ']' || c === ')' || c === '}') {
      if (--depth === 0) return i;
    }
  }
  throw new Error('editor.js: unbalanced brackets');
}

// Parses one row: arrays, numbers, quoted strings, constant names, + - * / and parentheses.
function parseRow(text, constants) {
  const tokens = text.match(/\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+|[A-Za-z_$][\w$]*|[[\](),+\-*/])/gy);
  if (!tokens || tokens.join('').length !== text.length) throw new Error(`editor.js: cannot read row ${text}`);
  const toks = tokens.map((t) => t.trim());
  let at = 0;
  const peek = () => toks[at];
  const take = () => toks[at++];

  function atom() {
    const t = take();
    if (t === '[') {
      const items = [];
      while (peek() !== ']') {
        items.push(sum());
        if (peek() === ',') take();
      }
      take();
      return items;
    }
    if (t === '(') {
      const v = sum();
      take();
      return v;
    }
    if (t === '-') return -atom();
    if (t[0] === "'" || t[0] === '"') return t.slice(1, -1).replace(/\\(.)/g, '$1');
    if (/^[\d.]/.test(t)) return Number(t);
    if (Object.hasOwn(constants, t)) return constants[t];
    throw new Error(`editor.js: ${t} is not a constant I was given`);
  }
  function product() {
    let v = atom();
    while (peek() === '*' || peek() === '/') v = take() === '*' ? v * atom() : v / atom();
    return v;
  }
  function sum() {
    let v = product();
    while (peek() === '+' || peek() === '-') v = take() === '+' ? v + product() : v - product();
    return v;
  }
  const row = sum();
  if (at !== toks.length) throw new Error(`editor.js: cannot read row ${text}`);
  return row;
}

// `constants`: name -> value, for the names a row may use as a bound. Returns one entry per slider (`s`), numeric
// select (`sel`) and string select (`sels`) row, in the table's order.
export function extractRows(source, constants) {
  const start = source.search(/\bconst PANEL\s*=\s*\[/);
  if (start < 0) throw new Error('editor.js: no PANEL table');
  const open = source.indexOf('[', start);
  const end = closing(source, open);

  const rows = [];
  for (let i = open + 1; i < end; i++) {
    if (source[i] === '/' && source[i + 1] === '/') {
      while (i < end && source[i] !== '\n') i++;
    } else if (source[i] === '[') {
      const rowEnd = closing(source, i);
      const text = source.slice(i, rowEnd + 1);
      const kind = /^\[\s*'(s|sel|sels)'\s*,/.exec(text)?.[1];
      if (kind) {
        const row = parseRow(text, constants);
        if (kind === 's') {
          const [, key, , min, max, step] = row;
          rows.push({ kind, key, min, max, step });
        } else {
          rows.push({ kind, key: row[1], choices: row[3].map(([, value]) => value) });
        }
      }
      i = rowEnd;
    }
  }
  return rows;
}
