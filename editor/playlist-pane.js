// ============================================================================
// The workspace's playlist pane (spec/implementation.md, "The editor and the player"): EDITOR only, imported by editor.js alone.
// It stands where the tree pane stands, one tab over, and while it is up it is the one home of looks and playlists: the editor moves
// the advanced panel's own look and playlist controls into its `slot` (the playlist select, + and rename, the look, save and save
// as new, the chips, arboretum's status line), so none are left in the panel below and none are copies. Under them it lists every
// item of the active list: a click on a name goes to that look the way the arrows do. On a playlist of yours each item also carries
// how long it is held (dwell), how long it takes to arrive (crossfade), its route (morph or fade) and an × that takes it out, a drag
// on its grip moves it, and a picker at the foot adds one of your looks without leaving the playlist; a list with no order of yours
// to change (your looks, a shipped playlist, uncategorized, someone else's playlist) has no grip, no × and no picker. Every write goes
// through what the editor lends (`act`), which arboretum.js answers; the pane keeps no copy of the list and draws the model it is
// handed on each `render`. A row being typed into is not redrawn under the hand: the pane waits for the input to let go.
// ============================================================================

const DWELL = { min: 1, max: 3600 }, CROSSFADE = { min: 0, max: 120 };   // arboretum's limits; a value outside them is refused there, and the stored one comes back

function el(tag, cls, text){
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(text !== undefined) e.textContent = text;
  return e;
}

// root: the pane's element. act: { go(value), move(at, to), times(at, {dwell_s} | {crossfade_s}), style(at, 'morph' | 'fade'),
// remove(at), add(pick) }, all but go promises, none of which is called while another is under way. A model: { editable, current,
// addable: [{ label, options: [{ value, label }] }], rows: [{ value, label, dwell_s?, crossfade_s?, style?, pending? }] } — the times
// and style present only on a cloud playlist's items.
export function makePlaylistPane(root, act){
  let model = null, wanted = false, busy = false, dragFrom = null, shownAt;   // shownAt: the item last scrolled into view

  const slot = el('div', 'pl-slot');
  const head = el('div', 'pl-head'), list = el('ol', 'pl-list');
  const picker = el('select', 'pl-add');
  picker.title = 'add one of your looks at the end of this playlist';
  picker.addEventListener('change', () => { const v = picker.value; picker.value = ''; if(v) write(() => act.add(v)); });
  root.append(slot, head, list, picker);
  let pickerKey = '';

  const typing = () => root.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'number';
  root.addEventListener('focusout', () => { setTimeout(() => { if(wanted && !typing()) draw(); }, 0); });

  async function write(p){
    if(busy) return;
    busy = true; root.classList.add('busy');
    try { await p(); } finally { busy = false; root.classList.remove('busy'); }
  }

  function timeInput(row, at, key, lim){
    const inp = el('input');
    inp.type = 'number'; inp.min = lim.min; inp.max = lim.max; inp.step = 'any';
    inp.value = row[key];
    inp.disabled = !model.editable || row.pending;
    inp.addEventListener('keydown', (e) => { if(e.key === 'Enter') inp.blur(); e.stopPropagation(); });   // the editor's keys (R, W, the arrows) are not this field's
    inp.addEventListener('change', () => {
      const v = Number(inp.value);
      if(inp.value === '' || !Number.isFinite(v) || v === row[key]){ inp.value = row[key]; return; }
      write(() => act.times(at, { [key]: v }));
    });
    return inp;
  }

  function rowEl(row, at){
    const li = el('li', 'pl-row');
    li.classList.toggle('on', row.value === model.current);
    li.classList.toggle('pending', !!row.pending);
    const movable = model.editable && !row.pending;
    const grip = el('span', 'pl-grip', movable ? '⋮⋮' : '');
    const n = el('span', 'pl-n', String(at + 1));
    const name = el('button', 'pl-name', row.label);
    name.title = row.pending ? 'waiting to go up' : 'go to this look';
    name.addEventListener('click', () => act.go(row.value));
    li.append(...(model.editable ? [grip] : []), n, name);
    if(row.dwell_s !== undefined){
      li.append(timeInput(row, at, 'dwell_s', DWELL), timeInput(row, at, 'crossfade_s', CROSSFADE));
      const st = el('button', 'pl-style', row.style);
      st.title = 'how it arrives: morph (the automatic route) or fade; click to change';
      st.disabled = !model.editable || row.pending;
      st.addEventListener('click', () => write(() => act.style(at, row.style === 'fade' ? 'morph' : 'fade')));
      li.append(st);
    }
    if(model.editable){
      const x = el('button', 'pl-remove', '×');
      x.title = 'take it out of this playlist (it stays in arboretum)';
      x.disabled = !movable;
      x.addEventListener('click', () => write(() => act.remove(at)));
      li.append(x);
    }
    if(movable){
      grip.draggable = true;
      grip.title = 'drag to move';
      grip.addEventListener('dragstart', (e) => { dragFrom = at; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(at)); li.classList.add('dragging'); });
      grip.addEventListener('dragend', () => { dragFrom = null; li.classList.remove('dragging'); clearMarks(); });
    }
    // a drop on a row's upper half puts the item before it, on its lower half after it
    li.addEventListener('dragover', (e) => {
      if(dragFrom === null) return;
      e.preventDefault();
      const r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height/2;
      clearMarks(); li.classList.add(after ? 'drop-after' : 'drop-before');
    });
    li.addEventListener('drop', (e) => {
      if(dragFrom === null) return;
      e.preventDefault();
      const r = li.getBoundingClientRect(), before = e.clientY > r.top + r.height/2 ? at + 1 : at;
      const from = dragFrom, to = from < before ? before - 1 : before;
      dragFrom = null; clearMarks();
      if(to !== from) write(() => act.move(from, to));
    });
    return li;
  }
  const clearMarks = () => { for(const r of list.children) r.classList.remove('drop-before', 'drop-after'); };

  function draw(){
    wanted = false;
    head.replaceChildren(el('span', 'pl-count', `${model.rows.length} look${model.rows.length === 1 ? '' : 's'}`));
    const timed = model.rows.some((r) => r.dwell_s !== undefined);
    if(timed){
      const cols = el('div', 'pl-cols');
      cols.append(el('span', '', 'hold s'), el('span', '', 'arrive s'), el('span', '', 'by'));
      head.append(cols);
    }
    root.classList.toggle('timed', timed);
    root.classList.toggle('editable', model.editable);
    list.replaceChildren(...model.rows.map(rowEl));
    const key = JSON.stringify(model.addable);
    if(key !== pickerKey){   // rebuilt only when what it offers changes, so an open dropdown is not closed under the hand
      pickerKey = key;
      const first = el('option', '', '+ add a look…'); first.value = '';
      picker.replaceChildren(first, ...model.addable.map((g) => {
        const og = el('optgroup'); og.label = g.label;
        og.append(...g.options.map((o) => { const e = el('option', '', o.label); e.value = o.value; return e; }));
        return og;
      }));
    }
    picker.hidden = !model.editable || model.addable.length === 0;
    if(model.current !== shownAt){ shownAt = model.current; list.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }   // only when the look moves: a list scrolled by hand stays put
  }

  return {
    slot,
    render(m){
      model = m;
      if(typing()) { wanted = true; return; }
      draw();
    },
  };
}
