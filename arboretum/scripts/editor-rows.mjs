// The komorebi editor's rows (spec §5, brief 07), read from komorebi's parameter registry: PARAMS in komorebi-params.js holds, for
// every parameter, the row the editor draws for it (a slider's range and step, a select's choices), and those are the bounds on a
// look. Pure on purpose (no `node:` imports): a test imports it.

// One entry per slider (`s`), numeric select (`sel`) and string select (`sels`) row, in the registry's order. A toggle (`t`) is
// bounded by its type alone, and a parameter with no row (`noRow`) by nothing here.
export function rowsOf(PARAMS) {
  if (!PARAMS || typeof PARAMS !== 'object') throw new Error('komorebi-params.js has no PARAMS: pin a komorebi commit that defines its parameters there');
  const rows = [];
  for (const [key, d] of Object.entries(PARAMS)) {
    const r = d.row;
    if (!r || r.kind === 't') continue;
    if (r.kind === 's') rows.push({ kind: 's', key, min: r.min, max: r.max, step: r.step });
    else if (r.kind === 'sel' || r.kind === 'sels') rows.push({ kind: r.kind, key, choices: r.choices.map(([, value]) => value) });
    else throw new Error(`PARAMS.${key}: a row of kind ${r.kind} I do not know`);
  }
  return rows;
}

// The editor's inputs a look may carry though the engine has no default for them (time_of_day, latitude).
export function inputKeys(PARAMS) {
  return Object.keys(PARAMS).filter((k) => 'input' in PARAMS[k]);
}
