const $ = (id) => document.getElementById(id);
const board = $('board');

let notes = []; // every note of every tab, archived ones too; what shows is filtered (see visible())
let tabs = []; // [{ id, name, columns }]
let tab; // the active tab
let columns = []; // the active tab's columns (the same array as tab.columns)
let labels = []; // [{ id, name, color }], shared by all tabs
let showing = 'notes'; // or 'archive': the active tab's archived notes
const filter = { q: '', overdue: false, today: false, labels: new Set() }; // Ctrl/Cmd+F
const X_IMAGE = /^image\/(png|jpeg|gif|webp)$/; // what can be pasted or dropped into a note
const COL_COLORS = ['#e57373', '#ffb74d', '#fff176', '#81c784', '#64b5f6', '#ba68c8']; // also label colours
let settings = {};
let meta = {}; // schema, palettes, fonts from main
let lastFocus = 0;
let toastTimer;
let viewKey; // what the notes were last drawn for: Markdown on/off + layout

const uid = () => Math.random().toString(36).slice(2, 10);
const save = () => api.saveNotes(notes);
const layoutOf = () => tab?.layout || settings.layout; // a tab's own Row/Board choice, else the default from Settings
const viewNow = () => settings.markdown + layoutOf();
const colOf = (n) => columns.find((c) => c.id === n.col) || columns[0];
const colors = () => meta.palettes[settings.palette];
const paint = (el, n) => { el.style.setProperty('--note-bg', `color-mix(in srgb, ${colors()[n.color % colors().length]} var(--pct), transparent)`); };
const newNote = () => { const t = Date.now(); return { id: uid(), text: '', color: notes.length % 5, created: t, updated: t, tab: tab.id }; };
const inTab = (n) => n.tab === tab.id && !n.archived;
const filtering = () => !!(filter.q || filter.overdue || filter.today || filter.labels.size);
function matches(n) {
  if (filter.overdue || filter.today) {
    const st = Time.dueState(n, new Date());
    if (!((filter.overdue && st === 'overdue') || (filter.today && st === 'today'))) return false;
  }
  if (filter.labels.size && !(n.labels || []).some((id) => filter.labels.has(id))) return false;
  if (!filter.q) return true;
  const hay = (n.text + ' ' + (n.labels || []).map((id) => labelOf(id)?.name || '').join(' ')).toLowerCase();
  return filter.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
const visible = () => notes.filter((n) => inTab(n) && matches(n)); // the active tab's notes that pass the filter, in order
const labelOf = (id) => labels.find((l) => l.id === id);
const ensureOne = () => { if (!notes.some(inTab)) notes.push(newNote()); }; // a tab always has a note to type in
const touch = (n) => { n.updated = Date.now(); }; // edits (not colour changes) rejuvenate a note
const refreshAll = () => board.querySelectorAll('.note').forEach((el) => el.refresh());
let openPop = null;
const closePop = () => { openPop?.remove(); openPop = null; };
function btn(text, title, onclick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.title = title;
  b.onclick = onclick;
  return b;
}

// ---- look & feel (all CSS-driven; main only handles window-level settings) ---
function applyStyle() {
  const root = document.documentElement.style;
  root.setProperty('--pct', settings.opacity + '%');
  root.setProperty('--font', meta.fonts[settings.font]);
  root.setProperty('--fs', settings.fontSize + 'px');
  root.setProperty('--note-w', settings.noteWidth + 'px');
  root.setProperty('--note-min', settings.noteMinWidth + 'px');
  document.documentElement.dataset.theme = settings.theme;
  document.body.dataset.valign = settings.valign;
  document.body.classList.toggle('no-anim', !settings.animate);
  $('toolbar').hidden = !settings.showToolbar;
  if (viewKey !== viewNow()) render(); // markdown or layout toggled: redraw notes (no focus change)
  document.body.dataset.aging = settings.aging;
  document.body.classList.toggle('no-foot', !settings.showAge);
  board.querySelectorAll('.note').forEach((el) => paint(el, el.note));
  refreshAll();
}

// ---- notes -----------------------------------------------------------------
function render(focusIdx) {
  viewKey = viewNow();
  closePop();
  renderChrome();
  if (showing === 'archive') return renderArchive();
  const boardMode = layoutOf() === 'board';
  board.classList.toggle('cols', boardMode);
  board.classList.remove('archive');
  const kept = new Map([...board.querySelectorAll('.col')].map((c) => [c.colData?.id, c.scrollTop])); // a drop or edit redraws: don't jump columns back to the top
  const shown = visible();
  board.replaceChildren(...(boardMode ? columns.map(colEl) : shown.map((n, i) => noteEl(n, i))));
  if (!shown.length && filtering()) board.append(el('p', { className: 'empty', textContent: 'No notes match the filter.' }));
  board.querySelectorAll('.col').forEach((c) => { if (kept.get(c.colData.id)) c.scrollTop = kept.get(c.colData.id); });
  if (focusIdx != null) focusNote(focusIdx);
}

// a rendered note's textarea is display:none, so switch it to editing before focusing
function focusNote(i) {
  if (showing === 'archive') return;
  const el = [...board.querySelectorAll('.note')].find((e) => e.note === notes[i]) || board.querySelector('.note');
  if (!el) return;
  el.classList.add('editing');
  const ta = el.querySelector('textarea');
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  el.scrollIntoView({ inline: 'nearest' });
}

function noteEl(n, i) {
  const el = document.createElement('section');
  el.className = 'note';
  el.note = n;
  paint(el, n);

  const head = document.createElement('div');
  head.className = 'note-head';
  const tools = document.createElement('div');
  tools.className = 'note-tools';
  const color = btn('●', 'Change colour', () => {
    n.color = (n.color + 1) % colors().length;
    paint(el, n);
    save();
  });
  const doneBtn = btn('✓', 'Mark done', () => {
    if (!n.done && n.repeat && n.due) return completeRecurring(n); // rolls to the next date instead of finishing
    n.done = !n.done;
    touch(n);
    if (layoutOf() === 'board') { // done means "in the done column"
      const target = n.done ? columns.find((c) => c.done) : colOf(n).done && columns[0];
      if (target) return moveNote(n, target.id);
    }
    save();
    if (n.done && settings.doneSink && layoutOf() === 'row') { // optionally park finished notes at the end
      notes.push(notes.splice(notes.indexOf(n), 1)[0]);
      render();
    } else el.refresh();
  });
  const dueBtn = btn('', 'Set due date', () => {
    if (openPop && openPop.parentNode === el) return closePop(); // second click closes
    closePop();
    openPop = duePop(n, el);
    el.append(openPop);
    openPop.querySelector('input').focus();
  });
  const labelBtn = btn('#', 'Labels', () => {
    if (openPop && openPop.parentNode === el) return closePop();
    closePop();
    openPop = labelPop(n, el);
    el.append(openPop);
    openPop.querySelector('input').focus();
  });
  labelBtn.className = 'label-btn';
  const progress = Object.assign(document.createElement('span'), { className: 'progress' }); // checklist "2/5", in the chips row
  tools.append(color, doneBtn, dueBtn, labelBtn);
  const grip = document.createElement('span'); // a visible cue that the header's empty space is a handle
  grip.className = 'note-grip';
  grip.textContent = '⠿';
  grip.setAttribute('aria-hidden', 'true');
  head.append(tools, grip, btn('×', 'Archive note', () => archiveNote(n)));
  const chips = document.createElement('div'); // the note's labels; clicking one filters by it
  chips.className = 'chips';
  head.title = 'Drag to move';
  makeDraggable(head, el, n, 'note'); // any empty part of the header is the handle, so text selection in the note still works

  const foot = document.createElement('div');
  foot.className = 'foot';

  // everything that depends on the clock or on the note's dates; called on edits and on a timer
  el.refresh = () => {
    const now = new Date();
    const state = Time.dueState(n, now);
    el.classList.toggle('done', !!n.done);
    el.classList.toggle('overdue', state === 'overdue');
    doneBtn.setAttribute('aria-pressed', !!n.done);
    doneBtn.title = n.done ? 'Mark not done' : 'Mark done';
    dueBtn.className = 'due ' + (!n.due ? 'empty' : state === 'none' ? 'quiet' : state);
    dueBtn.textContent = n.due ? (state === 'overdue' ? '⚠ ' : '') + (n.repeat ? '↻ ' : '') + Time.dueLabel(n.due, now) : '+ Due';
    dueBtn.title = (state === 'overdue' ? 'Overdue: change due date' : n.due ? 'Change due date' : 'Set due date') + (n.repeat ? ` (repeats ${Time.REPEATS[n.repeat].toLowerCase()})` : '');
    const cl = Time.checklist(n.text);
    progress.textContent = `☑ ${cl.done}/${cl.total}`;
    progress.title = `${cl.done} of ${cl.total} tasks done`;
    progress.classList.toggle('complete', cl.total > 0 && cl.done === cl.total);
    const mine = (n.labels || []).map(labelOf).filter(Boolean);
    chips.hidden = !mine.length && !cl.total;
    chips.replaceChildren(...(cl.total ? [progress] : []), ...mine.map((l) => labelChip(l, () => toggleLabelFilter(l.id))));
    labelBtn.classList.toggle('empty', !mine.length);
    el.style.setProperty('--age', settings.aging === 'off' ? 0 : Time.ageFraction(n.updated, now.getTime(), settings.agingDays).toFixed(3));
    foot.textContent = `Created ${Time.ago(n.created, now)} · edited ${Time.ago(n.updated, now)}`;
    foot.title = `Created ${new Date(n.created).toLocaleString()}\nEdited ${new Date(n.updated).toLocaleString()}`;
  };

  const ta = document.createElement('textarea');
  ta.value = n.text;
  ta.spellcheck = false;
  ta.placeholder = settings.markdown ? 'Write a note… (Markdown supported)' : 'Write a note…';
  ta.setAttribute('aria-label', `Note ${i + 1}`);
  ta.oninput = () => { n.text = ta.value; touch(n); save(); el.refresh(); };
  ta.onfocus = () => { lastFocus = notes.indexOf(n); el.classList.add('editing'); };

  // rendered Markdown shown while not editing; focus or click brings the textarea back
  const view = document.createElement('div');
  view.className = 'view';
  view.tabIndex = 0;
  view.setAttribute('aria-label', `Note ${i + 1} (rendered, activate to edit)`);
  const draw = () => view.replaceChildren(renderMarkdown(n.text));
  draw();
  view.onfocus = () => { el.classList.add('editing'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); };
  view.onmousedown = (e) => { if (e.target.closest('a, input, img.md-img')) e.preventDefault(); }; // don't start editing on link/checkbox/image
  view.onclick = (e) => {
    const img = e.target.closest('img.md-img');
    if (img?.dataset.attachment) return api.openAttachment(img.dataset.attachment); // a stored image opens in the system viewer
    const cb = e.target.closest('input[type=checkbox]');
    if (!cb) return;
    const lines = n.text.split('\n');
    lines[+cb.dataset.line] = lines[+cb.dataset.line].replace(/\[( |x|X)\]/, (_, c) => (c === ' ' ? '[x]' : '[ ]'));
    n.text = ta.value = lines.join('\n');
    touch(n);
    draw();
    save();
    el.refresh();
  };
  el.addEventListener('focusout', (e) => {
    if (el.contains(e.relatedTarget) || !settings.markdown || !n.text.trim()) return;
    draw();
    el.classList.remove('editing');
  });
  if (!settings.markdown || !n.text.trim()) el.classList.add('editing');

  // images: paste a screenshot or drop image files onto the note; they're stored with the notes and linked in the text
  const insertImages = async (files) => {
    const refs = [];
    for (const f of files) {
      const r = await api.saveAttachment(new Uint8Array(await f.arrayBuffer()), f.type);
      if (r.error) { toast(r.error); continue; }
      const alt = f.name && f.name !== 'image.png' ? f.name.replace(/\.[^.]+$/, '').replace(/[[\]]/g, '') : 'image';
      refs.push(`![${alt}](attachment:${r.name})`);
    }
    if (!refs.length) return;
    const add = refs.join('\n');
    if (document.activeElement === ta) { // at the cursor, on its own line
      const before = ta.value.slice(0, ta.selectionStart);
      ta.setRangeText((before && !before.endsWith('\n') ? '\n' : '') + add + '\n', ta.selectionStart, ta.selectionEnd, 'end');
    } else ta.value = ta.value.trimEnd() + (ta.value.trim() ? '\n\n' : '') + add;
    n.text = ta.value;
    touch(n);
    save();
    draw();
    el.refresh();
  };
  const imagesIn = (dt) => [...(dt?.files || [])].filter((f) => X_IMAGE.test(f.type));
  ta.onpaste = (e) => {
    const imgs = imagesIn(e.clipboardData);
    if (!imgs.length) return; // ordinary text paste
    e.preventDefault();
    insertImages(imgs);
  };
  el.addEventListener('dragover', (e) => { // files from outside (our own note drags are handled by the board)
    if (drag || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    el.classList.add('drop-file');
  });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop-file'); });
  el.addEventListener('drop', (e) => {
    if (drag || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    el.classList.remove('drop-file');
    const imgs = imagesIn(e.dataTransfer);
    if (imgs.length) insertImages(imgs); else toast('Only images (PNG, JPEG, GIF, WebP) can be dropped into a note.');
  });

  // right-click the header or the rendered note: copy / export, move to another tab, archive
  const menu = async (e) => {
    e.preventDefault();
    const others = tabs.filter((t) => t !== tab).map((t) => ({ id: t.id, name: t.name }));
    const action = await api.noteMenu({ text: n.text, due: n.due, repeat: n.repeat, labels: n.labels, done: n.done }, others);
    if (action === 'archive') archiveNote(n);
    else if (action === 'copied') toast('Copied as Markdown');
    else if (action === 'exported') toast('Note exported');
    else if (action?.startsWith('move:')) moveToTab(n, tabs.find((t) => t.id === action.slice(5)));
  };
  head.oncontextmenu = menu;
  view.oncontextmenu = menu;

  el.append(head, chips, view, ta, foot);
  el.refresh();
  return el;
}

function duePop(n, noteDiv) {
  const pop = document.createElement('div');
  pop.className = 'due-pop';
  const date = Object.assign(document.createElement('input'), { type: 'date' });
  const time = Object.assign(document.createElement('input'), { type: 'time' });
  date.setAttribute('aria-label', 'Due date');
  time.setAttribute('aria-label', 'Due time (optional)');
  const sync = () => {
    date.value = n.due ? n.due.slice(0, 10) : '';
    time.value = n.due && n.due.length > 10 ? n.due.slice(11) : '';
  };
  const repeat = el('select', {}, el('option', { value: '', textContent: 'Never' }),
    ...Object.entries(Time.REPEATS).map(([v, t]) => el('option', { value: v, textContent: t })));
  repeat.setAttribute('aria-label', 'Repeat');
  repeat.onchange = () => { if (repeat.value) n.repeat = repeat.value; else delete n.repeat; save(); noteRefresh(); };
  const noteRefresh = () => { noteDiv.refresh(); repeat.value = n.repeat || ''; repeat.disabled = !n.due; };
  const set = (v) => {
    if (v) n.due = v; else { delete n.due; delete n.repeat; } // no date, nothing to repeat
    touch(n);
    save();
    noteRefresh();
    sync();
  };
  date.onchange = time.onchange = () => set(date.value ? date.value + (time.value ? 'T' + time.value : '') : null);
  const inDays = (k) => { const d = new Date(); d.setDate(d.getDate() + k); return Time.toDateStr(d); };
  const quick = document.createElement('div');
  quick.className = 'row';
  quick.append(...[['Today', 0], ['Tomorrow', 1], ['Next week', 7]].map(([t, k]) => btn(t, `Due ${t.toLowerCase()}`, () => set(inDays(k)))));
  const when = document.createElement('div');
  when.className = 'row';
  when.append(date, time, btn('Clear', 'Remove due date', () => set(null)));
  const rep = Object.assign(document.createElement('label'), { className: 'row', title: 'Marking a repeating note done moves it to the next date and unticks its tasks' });
  rep.append('Repeat', repeat);
  pop.append(quick, when, rep);
  noteRefresh();
  pop.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePop(); } }; // Esc closes this, not the window
  sync();
  return pop;
}
document.addEventListener('pointerdown', (e) => {
  if (openPop && !openPop.contains(e.target) && !e.target.closest('.due, .col-menu-btn')) closePop();
});
setInterval(refreshAll, 30000); // due states and ages move with the clock

// ---- kanban board ----------------------------------------------------------
const saveCols = () => saveBoard(); // columns live in their tab
const DROP_CLASSES = ['drop-before', 'drop-after', 'drop-end', 'drop-col-before', 'drop-col-after'];
const clearDrop = () => board.querySelectorAll(DROP_CLASSES.map((c) => '.' + c).join()).forEach((x) => x.classList.remove(...DROP_CLASSES));

// Native HTML5 drag-and-drop. A header is draggable only when the press lands on its empty space, so its buttons stay
// buttons and a column's rename input can still select text. `drag` is the one drag in flight; anything else dragged
// over the board (files, text from other apps) is left alone. The drop target is found by hit-testing the pointer.
// kind 'note': item is a note, dropped in a column (board) or between notes (row); kind 'col': item is a column, dropped beside another.
let drag = null; // { kind, item, src, drop: what releasing here does (or null), at: last pointer position over the board }
const DRAG_TYPE = 'application/x-stickydrop'; // a private type: textareas and other apps don't accept it
function makeDraggable(head, src, item, kind) {
  head.onpointerdown = (e) => { head.draggable = !e.target.closest('input, button:not(.col-name)'); }; // a column's name can start a drag; a plain click still renames
  head.ondragstart = (e) => {
    drag = { kind, item, src, drop: null };
    const r = src.getBoundingClientRect();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(DRAG_TYPE, kind);
    e.dataTransfer.setDragImage(src, e.clientX - r.left, e.clientY - r.top);
    requestAnimationFrame(() => drag?.src.classList.add('dragging')); // after the drag image is taken
  };
  head.ondragend = endDrag;
}
function endDrag() {
  cancelAnimationFrame(scrollTick);
  scrollTick = 0;
  drag?.src.classList.remove('dragging');
  drag = null;
  clearDrop();
}
function aim(x, y) {
  clearDrop();
  drag.drop = null;
  const { kind, item } = drag;
  if (kind === 'note' && !board.classList.contains('cols')) { // row layout: drop between notes, by horizontal position
    const others = [...board.querySelectorAll(':scope > .note')].filter((n) => n.note !== item);
    if (!others.length) return;
    const before = others.find((n) => { const r = n.getBoundingClientRect(); return x < r.left + r.width / 2; });
    (before || others.at(-1)).classList.add(before ? 'drop-before' : 'drop-after');
    drag.drop = () => reorderNote(item, before?.note);
    return;
  }
  const col = document.elementFromPoint(x, y)?.closest('.col');
  if (!col) return;
  const c = col.colData;
  if (kind === 'col') {
    if (c === item) return;
    const right = x > col.getBoundingClientRect().left + col.offsetWidth / 2;
    col.classList.add(right ? 'drop-col-after' : 'drop-col-before');
    drag.drop = () => { columns.splice(columns.indexOf(item), 1); columns.splice(columns.indexOf(c) + (right ? 1 : 0), 0, item); saveCols(); render(); };
  } else {
    const before = [...col.querySelectorAll('.note')].find((n) => { if (n.note === item) return false; const r = n.getBoundingClientRect(); return y < r.top + r.height / 2; });
    (before || col).classList.add(before ? 'drop-before' : 'drop-end');
    drag.drop = () => moveNote(item, c.id, before?.note);
  }
}
// Auto-scroll while dragging near an edge: the board sideways (an off-screen column or note), the column under the pointer
// up and down. Faster the closer to the edge; it keeps going while the pointer rests there, and the drop marker follows.
const EDGE = 60, MAX_SPEED = 900; // px zone, px per second (by time, not per frame: 120 Hz displays would double it)
let scrollTick = 0, lastTick = 0;
const edgeSpeed = (p, lo, hi, dt) => { // signed px to scroll this frame, at least 1 inside the zone
  const zone = Math.min(EDGE, (hi - lo) / 3); // small areas keep a usable middle
  const depth = p < lo + zone ? -(lo + zone - p) : p > hi - zone ? p - (hi - zone) : 0;
  return Math.sign(depth) * Math.ceil(MAX_SPEED * dt * Math.min(1, Math.abs(depth) / zone));
};
function autoScroll(now) {
  scrollTick = 0;
  const dt = Math.min(now - lastTick, 50) / 1000; // a long gap (first frame, a stall) doesn't jump
  lastTick = now;
  if (!drag?.at) return;
  const { x, y } = drag.at;
  let moved = false;
  const nudge = (box, axis, delta) => {
    if (!delta) return;
    const before = box[axis];
    box[axis] += delta;
    moved ||= box[axis] !== before;
  };
  const b = board.getBoundingClientRect();
  nudge(board, 'scrollLeft', edgeSpeed(x, b.left, b.right, dt));
  const col = drag.kind === 'note' && document.elementFromPoint(x, y)?.closest('.col');
  if (col) { const r = col.getBoundingClientRect(); nudge(col, 'scrollTop', edgeSpeed(y, r.top, r.bottom, dt)); }
  if (!moved) return; // at the end (or out of the zone): wait for the next dragover
  aim(x, y);
  scrollTick = requestAnimationFrame(autoScroll);
}
board.addEventListener('dragover', (e) => {
  if (!drag) return;
  e.preventDefault(); // accept the drop
  e.dataTransfer.dropEffect = 'move';
  drag.at = { x: e.clientX, y: e.clientY };
  aim(e.clientX, e.clientY);
  if (!scrollTick) { lastTick = performance.now(); scrollTick = requestAnimationFrame(autoScroll); }
});
board.addEventListener('dragleave', (e) => { if (drag && !board.contains(e.relatedTarget)) { clearDrop(); drag.drop = null; drag.at = null; } });
board.addEventListener('drop', (e) => {
  if (!drag) return;
  e.preventDefault(); // never let a textarea insert anything
  const run = drag.drop;
  endDrag(); // dragend may not reach the source once render() has replaced it
  run?.();
});

// row layout: put n before note `before` (or at the end)
function reorderNote(n, before, keepFocus) {
  if (before === n) return;
  notes.splice(notes.indexOf(n), 1);
  const at = before ? notes.indexOf(before) : -1;
  notes.splice(at < 0 ? notes.length : at, 0, n);
  save();
  render(keepFocus ? notes.indexOf(n) : undefined);
}

// put n in column colId before note `before` (or at the end of that column); the done column marks it done
function moveNote(n, colId, before, keepFocus) {
  const col = columns.find((c) => c.id === colId);
  if (!col) return;
  if (col.done && !colOf(n).done && n.repeat && n.due) return completeRecurring(n); // a recurring note rolls on, it stays put
  if (col.collapsed) { delete col.collapsed; saveCols(); } // don't drop a note into a hidden column
  const from = colOf(n);
  notes.splice(notes.indexOf(n), 1);
  const at = before && before !== n ? notes.indexOf(before) : -1;
  if (at >= 0) notes.splice(at, 0, n);
  else {
    const last = notes.findLastIndex((m) => inTab(m) && colOf(m) === col);
    notes.splice(last < 0 ? notes.length : last + 1, 0, n);
  }
  n.col = col.id;
  if (col.done) n.done = true; else if (from.done) n.done = false;
  save();
  render(keepFocus ? notes.indexOf(n) : undefined);
}

function renameCol(c, nameBtn) {
  if (c.collapsed) { delete c.collapsed; saveCols(); return render(); }
  const head = nameBtn.parentNode;
  const input = el('input', { value: c.name, maxLength: 30, className: 'col-name', ariaLabel: 'Column name' });
  let finished = false;
  const finish = (ok) => {
    if (finished) return;
    finished = true;
    const v = input.value.trim();
    if (ok && v && v !== c.name) { c.name = v; saveCols(); }
    nameBtn.textContent = c.name;
    input.replaceWith(nameBtn);
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') { e.stopPropagation(); finish(false); } // Esc cancels the rename, not the window
  };
  input.onblur = () => finish(true);
  nameBtn.replaceWith(input);
  input.focus();
  input.select();
}

function colMenu(c, col) {
  const swatch = (i) => {
    const b = btn(i < 0 ? '∅' : '', i < 0 ? 'No colour' : `Colour ${i + 1}`, () => {
      if (i < 0) delete c.color; else c.color = i;
      saveCols();
      paintCol(c, col);
    });
    b.className = 'swatch';
    if (i >= 0) b.style.background = COL_COLORS[i];
    return b;
  };
  const limit = el('input', { type: 'number', min: 1, max: 99, value: c.limit ?? '', placeholder: 'none', ariaLabel: 'Note limit' });
  limit.onchange = () => {
    const v = Math.floor(+limit.value);
    if (v >= 1 && v <= 99) c.limit = v; else delete c.limit;
    saveCols();
    render();
  };
  const menu = el('div', { className: 'due-pop col-menu' },
    el('div', { className: 'row' }, ...[-1, 0, 1, 2, 3, 4, 5].map(swatch)),
    el('label', { className: 'row' }, 'Warn above ', limit, ' notes'));
  if (columns.length > 1) menu.append(btn('Delete column', 'Its notes move to the first column', () => {
    columns.splice(columns.indexOf(c), 1);
    for (const n of notes) if (n.tab === tab.id && n.col === c.id) n.col = columns[0].id;
    saveCols();
    save();
    render();
  }));
  menu.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePop(); } };
  return menu;
}

function paintCol(c, col) {
  if (c.color == null) col.style.removeProperty('--col-accent'); else col.style.setProperty('--col-accent', COL_COLORS[c.color]);
  col.classList.toggle('colored', c.color != null);
}

function colEl(c) {
  const all = notes.filter((n) => inTab(n) && colOf(n) === c); // the count and limit ignore the filter
  const mine = all.filter(matches);
  const nameBtn = btn(c.name, 'Rename column', () => renameCol(c, nameBtn));
  nameBtn.className = 'col-name';
  const fold = btn(c.collapsed ? '▸' : '▾', c.collapsed ? 'Expand column' : 'Collapse column', () => {
    if (c.collapsed) delete c.collapsed; else c.collapsed = true;
    saveCols();
    render();
  });
  fold.className = 'fold';
  const count = el('span', { className: 'count', textContent: c.limit ? `${all.length}/${c.limit}` : String(all.length) });
  const menuBtn = btn('⋮', 'Column options: colour, note limit, delete', () => {
    if (openPop && openPop.parentNode === col) return closePop();
    closePop();
    openPop = colMenu(c, col);
    col.append(openPop);
  });
  menuBtn.className = 'col-menu-btn';
  const head = el('div', { className: 'col-head' }, fold, nameBtn, count, el('span', { className: 'spacer' }),
    btn('+', `Add note to ${c.name}`, () => addNote(c.id)), menuBtn);
  const col = el('section', { className: 'col' }, head, ...mine.map((n) => noteEl(n, notes.indexOf(n))));
  col.setAttribute('aria-label', c.name);
  col.classList.toggle('collapsed', !!c.collapsed);
  col.classList.toggle('over-limit', !!c.limit && all.length > c.limit); // a soft warning, never blocks
  paintCol(c, col);

  col.colData = c;
  makeDraggable(head, col, c, 'col'); // drag a column header to reorder columns
  return col;
}

// + Column lives in the toolbar (board layout only), so the board's width goes to the columns
$('addcol').onclick = () => {
  if (columns.length >= 8) return;
  columns.push({ id: uid(), name: 'New column' });
  saveCols();
  render();
  const names = board.querySelectorAll('.col-name');
  names[names.length - 1].click(); // straight into naming it
  names[names.length - 1].scrollIntoView?.({ inline: 'nearest' });
};

function addNote(colId) {
  if (filtering()) closeFilter(); // a new note would be hidden by most filters
  showing = 'notes';
  notes.push(colId ? { ...newNote(), col: colId } : newNote());
  save();
  render(notes.length - 1);
}

// × archives a note (an empty one is simply deleted); the tab's Archive view restores or deletes it for good
function archiveNote(n) {
  const shown = visible();
  const next = shown[shown.indexOf(n) + 1] || shown[shown.indexOf(n) - 1]; // focus moves to a neighbour
  const empty = !n.text.trim();
  const idx = notes.indexOf(n);
  if (empty) notes.splice(idx, 1); else n.archived = Date.now();
  ensureOne();
  save();
  render(next ? notes.indexOf(next) : notes.findIndex(inTab));
  if (!empty) toast('Note archived', () => { delete n.archived; save(); render(notes.indexOf(n)); });
}

// Recurring note marked done: it stays open, its due date moves to the next occurrence and its ticked tasks reset
function completeRecurring(n) {
  const before = { due: n.due, text: n.text, updated: n.updated };
  n.due = Time.nextDue(n.due, n.repeat, new Date());
  n.text = n.text.replace(/^(\s*(?:[-*+]|\d+[.)])\s+\[)[xX](\])/gm, '$1 $2');
  touch(n);
  save();
  render(notes.indexOf(n));
  toast(`Done · next due ${Time.dueLabel(n.due, new Date())}`, () => { Object.assign(n, before); save(); render(notes.indexOf(n)); });
}

// ---- tabs ------------------------------------------------------------------
const saveBoard = () => api.saveBoard({ tabs, activeTab: tab.id, labels });
function switchTab(t, focusIdx) {
  if (!t) return;
  tab = t;
  columns = t.columns;
  showing = 'notes';
  ensureOne();
  saveBoard();
  render(focusIdx ?? notes.findIndex(inTab));
}
function addTab() {
  if (tabs.length >= 12) return;
  // no layout of its own: it starts on the Default layout setting, not the current tab's
  const t = { id: uid(), name: `Tab ${tabs.length + 1}`, columns: [{ id: 'todo', name: 'To do' }, { id: 'doing', name: 'Doing' }, { id: 'done', name: 'Done', done: true }] };
  tabs.push(t);
  switchTab(t);
  renameTab(t);
}
function renameTab(t) {
  const b = [...$('tabs').querySelectorAll('.tab')].find((x) => x.tabData === t);
  if (!b) return;
  const input = el('input', { value: t.name, maxLength: 24, className: 'tab-name', ariaLabel: 'Tab name' });
  let done = false;
  const finish = (ok) => {
    if (done) return;
    done = true;
    if (ok && input.value.trim()) t.name = input.value.trim();
    saveBoard();
    renderChrome();
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
  };
  input.onblur = () => finish(true);
  b.replaceWith(input);
  input.focus();
  input.select();
}
function deleteTab(t) {
  if (tabs.length < 2) return;
  const at = tabs.indexOf(t);
  const gone = notes.filter((n) => n.tab === t.id);
  tabs.splice(at, 1);
  notes = notes.filter((n) => n.tab !== t.id);
  save();
  switchTab(tabs[Math.min(at, tabs.length - 1)]);
  toast(`Tab "${t.name}" deleted`, () => { tabs.splice(at, 0, t); notes.push(...gone); save(); switchTab(t); });
}
// a note dropped on another tab moves there, into the same-named column slot if that tab has it, else its first column
function moveToTab(n, t) {
  if (t === tab) return;
  const from = { tab: n.tab, col: n.col };
  n.tab = t.id;
  if (!t.columns.some((c) => c.id === n.col)) n.col = t.columns[0].id;
  ensureOne();
  save();
  render(notes.findIndex(inTab));
  toast(`Moved to "${t.name}"`, () => { Object.assign(n, from); save(); switchTab(tabs.find((x) => x.id === from.tab) || tab, notes.indexOf(n)); });
}
function tabBtn(t, i) {
  const b = btn(t.name, `${t.name} (${navigator.platform.startsWith('Mac') ? 'Cmd' : 'Ctrl'}+${i + 1}) · double-click to rename`, () => (t === tab ? null : switchTab(t)));
  b.className = 'tab';
  b.tabData = t;
  b.setAttribute('aria-current', t === tab);
  b.ondblclick = () => renameTab(t);
  // drop a dragged note on a tab to move it there
  b.ondragover = (e) => { if (drag?.kind === 'note' && t !== tab) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; b.classList.add('drop-tab'); } };
  b.ondragleave = () => b.classList.remove('drop-tab');
  b.ondrop = (e) => { if (drag?.kind !== 'note') return; e.preventDefault(); const n = drag.item; endDrag(); b.classList.remove('drop-tab'); moveToTab(n, t); };
  if (t !== tab || tabs.length < 2) return b;
  const x = btn('×', `Delete tab "${t.name}" and its notes (undo for a few seconds)`, () => deleteTab(t));
  x.className = 'tab-x';
  return el('span', { className: 'tab-wrap' }, b, x);
}

// ---- labels ----------------------------------------------------------------
function labelChip(l, onclick) {
  const c = btn(l.name, `Label: ${l.name} (click to filter)`, onclick);
  c.className = 'chip';
  c.style.setProperty('--chip', COL_COLORS[l.color]);
  c.classList.toggle('on', filter.labels.has(l.id));
  return c;
}
function newLabel(name) {
  const l = { id: uid(), name: name.trim().slice(0, 24), color: labels.length % COL_COLORS.length };
  labels.push(l);
  saveBoard();
  return l;
}
function labelPop(n, noteEl) {
  const pop = el('div', { className: 'due-pop label-pop' });
  const toggle = (l, on) => {
    n.labels = (n.labels || []).filter((id) => id !== l.id);
    if (on) n.labels.push(l.id);
    if (!n.labels.length) delete n.labels;
    save();
    noteEl.refresh();
  };
  const list = el('div', { className: 'label-list' }, ...labels.map((l) => {
    const cb = el('input', { type: 'checkbox', checked: (n.labels || []).includes(l.id) });
    cb.onchange = () => toggle(l, cb.checked);
    return el('label', { className: 'row' }, cb, el('span', { className: 'dot', style: `--chip:${COL_COLORS[l.color]}` }), l.name);
  }));
  const input = el('input', { type: 'text', placeholder: labels.length ? 'New label…' : 'Name a label…', maxLength: 24, ariaLabel: 'New label' });
  input.onkeydown = (e) => {
    if (e.key !== 'Enter' || !input.value.trim()) return;
    e.preventDefault();
    const existing = labels.find((l) => l.name.toLowerCase() === input.value.trim().toLowerCase());
    toggle(existing || (labels.length < 24 ? newLabel(input.value) : null) || labels[0], true);
    closePop();
  };
  pop.append(list, input, el('p', { className: 'hint', textContent: 'Rename, recolour or delete labels in Settings.' }));
  pop.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePop(); } };
  return pop;
}
function labelSettings() { // Settings → Labels: add, rename, recolour, delete
  const redraw = () => $('labels-set').replaceWith(labelSettings());
  const rows = labels.map((l) => {
    const sw = btn('', 'Change colour', () => { l.color = (l.color + 1) % COL_COLORS.length; sw.style.background = COL_COLORS[l.color]; saveBoard(); render(); });
    sw.className = 'swatch';
    sw.style.background = COL_COLORS[l.color];
    const name = el('input', { type: 'text', value: l.name, maxLength: 24, ariaLabel: 'Label name' });
    name.onchange = () => { if (name.value.trim()) { l.name = name.value.trim(); saveBoard(); render(); } else name.value = l.name; };
    const used = notes.filter((n) => n.labels?.includes(l.id)).length;
    const del = btn('×', `Delete label "${l.name}" (removes it from every note)`, () => {
      labels.splice(labels.indexOf(l), 1);
      for (const n of notes) if (n.labels) { n.labels = n.labels.filter((id) => id !== l.id); if (!n.labels.length) delete n.labels; }
      filter.labels.delete(l.id);
      save();
      saveBoard();
      render();
      redraw();
    });
    del.className = 'icon';
    return el('div', { className: 'setting label-row' }, sw, name, el('small', { textContent: used === 1 ? '1 note' : `${used} notes` }), del);
  });
  const add = el('input', { type: 'text', placeholder: 'New label…', maxLength: 24, ariaLabel: 'New label' });
  add.onkeydown = (e) => {
    if (e.key !== 'Enter' || !add.value.trim() || labels.length >= 24) return;
    e.preventDefault();
    if (!labels.some((l) => l.name.toLowerCase() === add.value.trim().toLowerCase())) { newLabel(add.value); render(); }
    redraw();
    $('labels-set').querySelector('input[aria-label="New label"]').focus();
  };
  return el('section', { className: 'settings-section', id: 'labels-set' },
    el('h3', { textContent: 'Labels' }),
    el('p', { className: 'section-hint', textContent: 'Shared by every tab. Click a swatch to recolour, edit a name to rename. Tick labels on a note with its # button.' }),
    ...rows,
    el('div', { className: 'setting label-row' }, add, el('small', { textContent: 'Enter to add' })));
}

// ---- filter (Ctrl/Cmd+F) ---------------------------------------------------
function openFilter() {
  $('filterbar').hidden = false;
  $('q').focus();
  $('q').select();
  renderChrome();
}
function closeFilter() {
  Object.assign(filter, { q: '', overdue: false, today: false });
  filter.labels.clear();
  $('q').value = '';
  $('filterbar').hidden = true;
  render(lastFocus);
}
function toggleLabelFilter(id) {
  if (filter.labels.has(id)) filter.labels.delete(id); else filter.labels.add(id);
  $('filterbar').hidden = false;
  render();
}
$('q').oninput = () => { filter.q = $('q').value.trim(); render(); };
$('q').onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeFilter(); } };
$('fclose').onclick = closeFilter;
$('find').onclick = () => ($('filterbar').hidden ? openFilter() : closeFilter());

// ---- sort (one-off: rearranges the tab's notes, within each column on the board) ----
const SORTS = {
  due: ['Due date', (a, b) => (Time.parseDue(a.due) ?? Infinity) - (Time.parseDue(b.due) ?? Infinity)],
  edited: ['Recently edited', (a, b) => b.updated - a.updated],
  created: ['Oldest first', (a, b) => a.created - b.created],
  color: ['Colour', (a, b) => a.color - b.color],
  label: ['Label', (a, b) => labelRank(a) - labelRank(b)],
};
const labelRank = (n) => Math.min(...(n.labels || []).map((id) => labels.findIndex((l) => l.id === id)).filter((i) => i >= 0), Infinity);
function sortNotes(key) {
  const [name, cmp] = SORTS[key];
  const prev = notes.slice();
  const mine = notes.filter(inTab);
  const slots = mine.map((n) => notes.indexOf(n));
  [...mine].sort(cmp).forEach((n, i) => { notes[slots[i]] = n; }); // stable; other tabs and archived notes stay put
  save();
  render();
  toast(`Sorted by ${name.toLowerCase()}`, () => { notes = prev; save(); render(); });
}
$('sort').onclick = () => {
  if (openPop?.id === 'sort-menu') return closePop();
  closePop();
  openPop = el('div', { className: 'due-pop', id: 'sort-menu' }, el('span', { className: 'hint', textContent: 'Sort this tab by' }),
    ...Object.entries(SORTS).map(([k, [name]]) => btn(name, `Sort by ${name.toLowerCase()} (once; drag to adjust)`, () => { closePop(); sortNotes(k); })));
  openPop.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePop(); } };
  $('app').append(openPop);
  const r = $('sort').getBoundingClientRect();
  Object.assign(openPop.style, { position: 'fixed', top: r.bottom + 4 + 'px', left: Math.max(4, r.right - 180) + 'px' });
  openPop.querySelector('button').focus();
};

// ---- archive view ----------------------------------------------------------
$('archive').onclick = () => { showing = showing === 'archive' ? 'notes' : 'archive'; render(showing === 'notes' ? lastFocus : undefined); };
function armed(b, label, run) { // two clicks for anything that can't be undone
  b.onclick = () => {
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Click again'; setTimeout(() => { delete b.dataset.armed; b.textContent = label; }, 4000); return; }
    run();
  };
  return b;
}
function renderArchive() {
  board.classList.remove('cols');
  board.classList.add('archive');
  const gone = notes.filter((n) => n.tab === tab.id && n.archived).sort((a, b) => b.archived - a.archived);
  const now = new Date();
  const cards = gone.map((n) => el('section', { className: 'note archived-note' },
    el('div', { className: 'view' }, renderMarkdown(n.text)),
    el('div', { className: 'foot row' }, `Archived ${Time.ago(n.archived, now)}`, el('span', { className: 'spacer' }),
      btn('Restore', 'Put it back on the board', () => { delete n.archived; save(); render(); }),
      armed(btn('Delete', 'Delete for good'), 'Delete', () => { notes.splice(notes.indexOf(n), 1); save(); render(); }))));
  cards.forEach((c, i) => paint(c, gone[i]));
  const head = el('div', { className: 'archive-head' }, el('strong', { textContent: `Archive: ${tab.name}` }),
    el('span', { className: 'spacer' }),
    ...(gone.length ? [armed(btn('Empty archive', 'Delete every archived note in this tab for good'), 'Empty archive', () => { notes = notes.filter((n) => !gone.includes(n)); save(); render(); })] : []),
    btn('Back to notes', 'Close the archive (Esc)', () => { showing = 'notes'; render(lastFocus); }));
  board.replaceChildren(head, ...(cards.length ? cards : [el('p', { className: 'empty', textContent: 'Nothing archived in this tab. × on a note archives it.' })]));
}

// the toolbar's Layout button: this tab only (other tabs keep theirs)
$('layout').onclick = () => {
  tab.layout = layoutOf() === 'board' ? 'row' : 'board';
  saveBoard();
  render(lastFocus);
};

// toolbar state: tabs, layout, archive count, filter chips and count
function renderChrome() {
  $('layout').textContent = layoutOf() === 'board' ? 'Layout: Board' : 'Layout: Row';
  $('addcol').hidden = layoutOf() !== 'board' || showing === 'archive' || columns.length >= 8;
  $('layout').title = `Switch this tab to ${layoutOf() === 'board' ? 'a row of notes' : 'a Kanban board'} (other tabs keep their own layout)`;
  $('tabs').replaceChildren(...tabs.map(tabBtn), ...(tabs.length < 12 ? [Object.assign(btn('+', 'New tab', addTab), { className: 'tab-add' })] : []));
  const archived = notes.filter((n) => n.tab === tab.id && n.archived).length;
  $('archive').textContent = archived ? `Archive (${archived})` : 'Archive';
  $('archive').setAttribute('aria-pressed', showing === 'archive');
  $('find').setAttribute('aria-pressed', !$('filterbar').hidden);
  const quick = (key, name) => {
    const b = btn(name, `Only notes ${name.toLowerCase()}`, () => { filter[key] = !filter[key]; render(); });
    b.className = 'chip quick' + (filter[key] ? ' on' : '');
    return b;
  };
  $('quick').replaceChildren(quick('overdue', 'Overdue'), quick('today', 'Due today'), ...labels.map((l) => labelChip(l, () => toggleLabelFilter(l.id))));
  const total = notes.filter(inTab).length;
  $('fcount').textContent = filtering() ? `${visible().length} of ${total}` : '';
}

function toast(msg, onUndo) { // a message, with Undo when there is something to undo
  clearTimeout(toastTimer);
  $('toast-msg').textContent = msg;
  $('toast').hidden = false;
  $('undo').hidden = !onUndo;
  $('undo').onclick = () => { $('toast').hidden = true; onUndo(); };
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6000);
}

// ---- settings --------------------------------------------------------------
const MAP = { Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', ArrowUp: 'Up', ArrowDown: 'Down',
  ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Return', Space: 'Space', Tab: 'Tab', Backspace: 'Backspace' };

// KeyboardEvent -> Electron accelerator, or null if not a valid global shortcut yet
function toAccel(e) {
  let key = e.code;
  if (/^Key[A-Z]$/.test(key)) key = key[3];
  else if (/^Digit\d$/.test(key)) key = key[5];
  else if (/^F\d{1,2}$/.test(key)) { /* as is */ }
  else if (MAP[key]) key = MAP[key];
  else return null; // bare modifier press or unsupported key
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  if (!mods.length && !/^F\d/.test(key)) return null; // plain letters would hijack typing everywhere
  return [...mods, key].join('+');
}

async function apply(patch) {
  const r = await api.setSettings(patch);
  if (r.ok) { settings = r.settings; applyStyle(); }
  $('settings-err').textContent = r.ok ? '' : r.error;
  syncControls();
  return r;
}

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

// Settings → Data: sync folder, export, import. Results and problems show in a status line at the bottom.
function dataSettings() {
  const wrap = el('div', { id: 'data-set' });
  const status = el('p', { className: 'section-hint data-status', role: 'status' });
  const say = (msg) => { status.textContent = msg || ''; };
  const redraw = () => $('data-set')?.replaceWith(dataSettings());
  const row = (label, hint, ...controls) => el('div', { className: 'setting' },
    el('div', { className: 'setting-text' }, el('span', { textContent: label }), ...(hint ? [el('small', { textContent: hint })] : [])),
    el('div', { className: 'setting-control' }, ...controls));
  const folder = el('div');
  const use = async (dir, mode) => {
    const r = await api.setSyncDir(dir, mode);
    if (r.error) return say(r.error);
    redraw();
  };
  api.dataInfo().then((info) => {
    const where = !info.syncDir ? 'Notes are kept on this computer only'
      : info.syncOk ? info.syncDir : `Not found: ${info.syncDir}. Using the copy on this computer until it's back (restart then)`;
    const choose = btn(info.syncDir ? 'Change…' : 'Choose folder…', 'Pick a synced folder for your notes', async () => {
      const r = await api.chooseSyncDir();
      if (r.canceled) return;
      if (r.theirs == null) return use(r.dir, 'mine'); // an empty folder: these notes go there
      folder.replaceChildren(row(`That folder already has StickyDrop notes (${r.theirs})`,
        'Use them here (a copy of yours stays on this computer), or replace them with yours',
        btn('Use those notes', 'Switch to the notes in that folder', () => use(r.dir, 'theirs')),
        btn('Replace with mine', 'Write your notes to that folder', () => use(r.dir, 'mine')),
        btn('Cancel', 'Keep things as they are', redraw)));
    });
    const stop = btn('Stop syncing', 'Keep the notes on this computer only (they stay as they are now)', async () => { await api.stopSync(); redraw(); });
    folder.replaceChildren(
      row('Sync folder', where, choose, ...(info.syncDir ? [stop] : [])),
      row('Data folder', info.dataDir, btn('Open', 'Show the folder with your notes and images', () => api.openDataFolder())));
  });
  const exportMd = btn('Export…', 'Choose a folder to export to', async () => {
    const r = await api.exportMarkdown();
    if (!r.canceled) say(`Exported ${r.files.length} file${r.files.length === 1 ? '' : 's'} to ${r.dir}`);
  });
  const backup = btn('Export…', 'Save a backup file', async () => {
    const r = await api.exportBackup();
    if (!r.canceled) say(`Backup saved to ${r.file}`);
  });
  const importMd = btn('Import…', 'Choose .md or .txt files', async () => {
    const r = await api.importMarkdown();
    if (r.canceled) return;
    for (const f of r.files) notes.push({ ...newNote(), text: f.text });
    if (r.files.length) { save(); render(); }
    say(`Imported ${r.files.length} note${r.files.length === 1 ? '' : 's'} into "${tab.name}"` + (r.skipped.length ? `; skipped ${r.skipped.join(', ')} (unreadable or over 1 MB)` : ''));
  });
  const restore = armed(btn('Restore…', 'Two clicks: replaces your notes'), 'Restore…', async () => {
    const r = await api.restoreBackup();
    if (r.canceled) return;
    say(r.error || `Restored ${r.notes} notes. Your previous notes are in ${r.safety}`);
  });
  wrap.append(
    el('section', { className: 'settings-section' }, el('h3', { textContent: 'Sync' }),
      el('p', { className: 'section-hint', textContent: 'Keep your notes in a folder that Dropbox, Syncthing, iCloud Drive or similar syncs, and choose the same folder on each computer. Notes, tabs, labels and images sync; settings stay per computer.' }),
      folder),
    el('section', { className: 'settings-section' }, el('h3', { textContent: 'Export' }),
      row('Notes as Markdown', 'Every tab as a .md file, with its images', exportMd),
      row('Backup', 'Everything in one JSON file, settings included', backup)),
    el('section', { className: 'settings-section' }, el('h3', { textContent: 'Import' }),
      row('Markdown or text files', 'Each file becomes a note in the current tab', importMd),
      row('Restore a backup', 'Replaces all notes, tabs and labels with the backup\'s; yours are kept in a safety copy first. Settings stay.', restore)),
    status);
  return wrap;
}

// one settings row: label and hint on the left, the control on the right
function settingRow(forId, label, hint, control, value) {
  const text = el('div', { className: 'setting-text' }, el('label', { htmlFor: forId, textContent: label }), ...(hint ? [el('small', { textContent: hint })] : []));
  return el('div', { className: 'setting' }, text, el('div', { className: 'setting-control' }, ...(value ? [value] : []), control));
}

function control(key, spec) {
  const id = 's-' + key;
  if (spec.type === 'check') {
    const input = el('input', { type: 'checkbox', id, className: 'switch' });
    input.onchange = () => apply({ [key]: input.checked });
    return settingRow(id, spec.label, spec.hint, input);
  }
  if (spec.type === 'range') {
    const out = el('output', { id: id + '-out' });
    const input = el('input', { type: 'range', id, min: spec.min, max: spec.max, step: spec.step });
    input.oninput = () => { out.textContent = input.value + spec.unit; apply({ [key]: +input.value }); };
    return settingRow(id, spec.label, spec.hint, input, out);
  }
  const select = el('select', { id }, ...Object.entries(spec.options).map(([v, t]) => el('option', { value: v, textContent: t })));
  select.onchange = () => apply({ [key]: select.value });
  return settingRow(id, spec.label, spec.hint, select);
}

function hotkeyControl() {
  const hk = el('button', { type: 'button', id: 'hotkey' });
  hk.onclick = () => { hk.classList.add('capturing'); hk.textContent = 'Press new shortcut…'; };
  hk.onblur = () => { hk.classList.remove('capturing'); hk.textContent = settings.hotkey; };
  hk.onkeydown = (e) => {
    if (!hk.classList.contains('capturing')) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return hk.blur();
    const accel = toAccel(e);
    if (accel) { hk.blur(); apply({ hotkey: accel }); }
  };
  return settingRow('hotkey', 'Show / hide shortcut', 'Works from any app. Click, then press the new keys', hk);
}

function syncControls() { // reflect settings in the form, without fighting a control the user is dragging
  for (const [key, spec] of Object.entries(meta.schema)) {
    const c = $('s-' + key);
    if (!c || c === document.activeElement) continue;
    if (spec.type === 'check') c.checked = settings[key];
    else c.value = settings[key];
    if (spec.type === 'range') $('s-' + key + '-out').textContent = settings[key] + spec.unit;
  }
  const hk = $('hotkey');
  if (hk && !hk.classList.contains('capturing')) hk.textContent = settings.hotkey;
}

// Settings: a tab per group (General, Window, Appearance, Notes, Reminders) plus Labels; sections inside each.
// Built from the schema main sends, so a new setting only needs its group and section there.
let settingsTab = 'General';
function showSettingsTab(name, focus) {
  settingsTab = name;
  for (const b of $('settings-nav').children) b.setAttribute('aria-selected', b.dataset.tab === name);
  for (const p of $('settings-body').children) p.hidden = p.dataset.tab !== name;
  $('settings-body').scrollTop = 0;
  if (focus) $('settings-nav').querySelector('[aria-selected="true"]').focus();
}
async function openSettings() {
  meta.schema = (await api.load()).schema; // monitor list may have changed
  const groups = {}; // group -> section -> rows
  for (const [key, spec] of Object.entries(meta.schema)) ((groups[spec.group] ||= {})[spec.section] ||= []).push(control(key, spec));
  groups.General.Shortcut.unshift(hotkeyControl());
  const panel = (name, ...kids) => {
    const p = el('div', { className: 'settings-panel', role: 'tabpanel', ariaLabel: name }, ...kids);
    p.dataset.tab = name;
    return p;
  };
  const panels = [
    ...Object.entries(groups).map(([name, sections]) => panel(name,
      ...Object.entries(sections).map(([sec, rows]) => el('section', { className: 'settings-section' }, el('h3', { textContent: sec }), ...rows)))),
    panel('Labels', labelSettings()),
    panel('Data', dataSettings()),
  ];
  $('settings-body').replaceChildren(...panels);
  $('settings-nav').replaceChildren(...panels.map((p) => {
    const b = btn(p.dataset.tab, `${p.dataset.tab} settings`, () => showSettingsTab(p.dataset.tab));
    b.dataset.tab = p.dataset.tab;
    b.setAttribute('role', 'tab');
    return b;
  }));
  if (!panels.some((p) => p.dataset.tab === settingsTab)) settingsTab = 'General';
  syncControls();
  $('settings-err').textContent = '';
  disarmReset();
  $('settings').hidden = false;
  showSettingsTab(settingsTab, true);
}
$('settings-nav').onkeydown = (e) => { // arrow keys move between settings tabs
  const tabsEls = [...$('settings-nav').children];
  const i = tabsEls.findIndex((b) => b.dataset.tab === settingsTab);
  const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
  if (!d) return;
  e.preventDefault();
  showSettingsTab(tabsEls[(i + d + tabsEls.length) % tabsEls.length].dataset.tab, true);
};

let resetTimer;
$('reset').onclick = async (e) => { // two clicks: no modal dialog to block the window
  const b = e.target;
  if (!b.dataset.armed) {
    b.dataset.armed = '1';
    b.textContent = 'Click again to confirm';
    resetTimer = setTimeout(disarmReset, 4000);
    return;
  }
  disarmReset();
  const r = await api.resetSettings();
  settings = r.settings;
  applyStyle();
  syncControls();
  $('settings-err').textContent = r.ok ? '' : r.error;
};
function disarmReset() {
  clearTimeout(resetTimer);
  delete $('reset').dataset.armed;
  $('reset').textContent = 'Reset to defaults';
}
$('settings-close').onclick = () => { $('settings').hidden = true; };
$('quit').onclick = () => api.quit();
$('settings-form').onsubmit = (e) => e.preventDefault();

// ---- chrome ----------------------------------------------------------------
// drag the edge grip to resize; the new height is remembered (pointer capture keeps the drag alive off-window)
$('grip').onpointerdown = (e) => {
  const grip = e.currentTarget;
  const sign = settings.valign === 'bottom' ? -1 : 1; // the grip is on the edge away from the screen edge
  const y0 = e.screenY, h0 = window.innerHeight;
  let h = h0, queued = false;
  grip.setPointerCapture(e.pointerId);
  grip.onpointermove = (m) => {
    if (!(m.buttons & 1)) return; // a stray move (e.g. the window growing under a resting cursor) is not part of the drag
    h = h0 + sign * (m.screenY - y0);
    if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; api.resizeHeight(h, false); }); }
  };
  grip.onpointerup = async (u) => {
    grip.onpointermove = grip.onpointerup = null;
    h = h0 + sign * (u.screenY - y0); // where it was released, even if the last move was coalesced away
    const r = await api.resizeHeight(h, true);
    settings = r.settings;
    syncControls();
  };
};
$('grip').ondblclick = () => apply({ heightPct: meta.schema.heightPct.def });
$('add').onclick = () => addNote();
$('gear').onclick = openSettings;
$('close').onclick = () => api.hide();
$('pin').onclick = (e) => {
  const on = e.target.getAttribute('aria-pressed') !== 'true';
  e.target.setAttribute('aria-pressed', on);
  api.setPinned(on);
};

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') { // closes the innermost thing first; with nothing open it hides the window
    if (!$('settings').hidden) $('settings').hidden = true;
    else if (openPop) closePop();
    else if (showing === 'archive') { showing = 'notes'; render(lastFocus); }
    else if (!$('filterbar').hidden) closeFilter();
    else api.hide();
  } else if (mod && e.key === 'n') { e.preventDefault(); addNote(); }
  else if (mod && e.key === 'f') { e.preventDefault(); openFilter(); }
  else if (mod && /^[1-9]$/.test(e.key) && !e.altKey) { e.preventDefault(); switchTab(tabs[+e.key - 1]); }
  else if (e.altKey && e.key.startsWith('Arrow')) { // move the focused note
    const n = document.activeElement.closest?.('.note')?.note;
    if (!n) return;
    e.preventDefault();
    const shown = visible();
    if (layoutOf() !== 'board') { // row: Alt+Left/Up earlier, Alt+Right/Down later
      const i = shown.indexOf(n), back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
      if (back && i > 0) reorderNote(n, shown[i - 1], true);
      else if (!back && i < shown.length - 1) reorderNote(n, shown[i + 2], true);
      return;
    }
    const col = columns.indexOf(colOf(n));
    const mine = shown.filter((m) => colOf(m) === colOf(n));
    const pos = mine.indexOf(n);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const to = columns[col + (e.key === 'ArrowLeft' ? -1 : 1)];
      if (to) moveNote(n, to.id, null, true);
    } else if (e.key === 'ArrowUp' && pos > 0) moveNote(n, colOf(n).id, mine[pos - 1], true);
    else if (e.key === 'ArrowDown' && pos < mine.length - 1) moveNote(n, colOf(n).id, mine[pos + 2], true);
  }
  else if (mod && e.key === ',') { e.preventDefault(); openSettings(); }
});

api.onShow(() => {
  const app = $('app');
  app.classList.remove('in');
  void app.offsetWidth; // restart the slide-down
  app.classList.add('in');
  refreshAll();
  if ($('settings').hidden) focusNote(lastFocus);
});

// a tray item or a reminder was clicked: go to that note's tab and focus it
api.onFocusNote((id) => {
  const n = notes.find((x) => x.id === id && !x.archived);
  if (!n) return;
  $('settings').hidden = true;
  if (!matches(n)) closeFilter();
  switchTab(tabs.find((t) => t.id === n.tab) || tab, notes.indexOf(n));
});

// make loaded notes consistent with this version (at startup, after a restore, after another computer synced)
function normalize() {
  for (const n of notes) {
    if (!tabs.some((t) => t.id === n.tab)) n.tab = tabs[0].id; // notes from before tabs belong to the first
    if (n.labels) { n.labels = n.labels.filter(labelOf); if (!n.labels.length) delete n.labels; } // labels that no longer exist
    if (n.archived != null && !Number.isFinite(n.archived)) delete n.archived;
    if (n.repeat && !Time.REPEATS[n.repeat]) delete n.repeat;
    if (typeof n.color !== 'number') n.color = Math.max(0, meta.palettes.classic.indexOf(n.color)); // old versions stored a hex colour
    n.created ??= Date.now(); // notes from before dates existed start fresh
    n.updated ??= n.created;
  }
}

// the notes changed underneath us: another computer synced, or a backup was restored
api.onDataChanged((d) => {
  // the note being typed in keeps this computer's text, cursor and focus (its newest keystrokes may not be in d yet)
  const ta = document.activeElement?.tagName === 'TEXTAREA' ? document.activeElement : null;
  const mine = ta?.closest('.note')?.note;
  const sel = ta && [ta.selectionStart, ta.selectionEnd];
  ({ notes, tabs, labels } = d);
  tab = tabs.find((t) => t.id === tab.id) || tabs.find((t) => t.id === d.activeTab) || tabs[0];
  columns = tab.columns;
  normalize();
  for (const id of [...filter.labels]) if (!labelOf(id)) filter.labels.delete(id);
  const kept = mine && notes.find((n) => n.id === mine.id);
  if (kept && kept.text !== mine.text) { Object.assign(kept, { text: mine.text, updated: mine.updated }); save(); }
  if (!notes.some(inTab)) switchTab(tab);
  else if (kept && inTab(kept)) {
    render(notes.indexOf(kept));
    const t = document.activeElement;
    if (t?.tagName === 'TEXTAREA') t.setSelectionRange(...sel);
  } else render(lastFocus);
  if (d.why) toast(d.why);
  if (!$('settings').hidden && $('labels-set')) $('labels-set').replaceWith(labelSettings());
});

(async () => {
  const d = await api.load();
  ({ settings, notes, tabs, labels } = d);
  tab = tabs.find((t) => t.id === d.activeTab) || tabs[0];
  columns = tab.columns;
  meta = d; // before normalize(): it needs the palettes
  normalize();
  ensureOne();
  render(notes.findIndex(inTab));
  applyStyle();
  save(); // persist the migration
})();
