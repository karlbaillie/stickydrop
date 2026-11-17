const $ = (id) => document.getElementById(id);
const board = $('board');

let notes = [];
let settings = {};
let meta = {}; // schema, palettes, fonts from main
let lastFocus = 0;
let toastTimer;
let mdState;

const uid = () => Math.random().toString(36).slice(2, 10);
const save = () => api.saveNotes(notes);
const colors = () => meta.palettes[settings.palette];
const paint = (el, n) => { el.style.setProperty('--note-bg', `color-mix(in srgb, ${colors()[n.color % colors().length]} var(--pct), transparent)`); };
const newNote = () => { const t = Date.now(); return { id: uid(), text: '', color: notes.length % 5, created: t, updated: t }; };
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
  document.documentElement.dataset.theme = settings.theme;
  document.body.dataset.valign = settings.valign;
  document.body.classList.toggle('no-anim', !settings.animate);
  $('toolbar').hidden = !settings.showToolbar;
  if (mdState !== settings.markdown) render(); // markdown toggled: redraw notes (no focus change)
  document.body.dataset.aging = settings.aging;
  document.body.classList.toggle('no-foot', !settings.showAge);
  board.querySelectorAll('.note').forEach((el, i) => paint(el, notes[i]));
  refreshAll();
}

// ---- notes -----------------------------------------------------------------
function render(focusIdx) {
  mdState = settings.markdown;
  closePop();
  board.replaceChildren(...notes.map(noteEl));
  if (focusIdx != null) focusNote(focusIdx);
}

// a rendered note's textarea is display:none, so switch it to editing before focusing
function focusNote(i) {
  const el = board.children[Math.min(i, board.children.length - 1)];
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
    n.done = !n.done;
    touch(n);
    save();
    if (n.done && settings.doneSink) { // optionally park finished notes at the end
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
  tools.append(color, doneBtn, dueBtn);
  head.append(tools, btn('×', 'Delete note', () => removeNote(n)));

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
    dueBtn.textContent = n.due ? (state === 'overdue' ? '⚠ ' : '') + Time.dueLabel(n.due, now) : '+ Due';
    dueBtn.title = state === 'overdue' ? 'Overdue: change due date' : n.due ? 'Change due date' : 'Set due date';
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
  view.onmousedown = (e) => { if (e.target.closest('a, input')) e.preventDefault(); }; // don't start editing on link/checkbox
  view.onclick = (e) => {
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

  el.append(head, view, ta, foot);
  el.refresh();
  return el;
}

function duePop(n, el) {
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
  const set = (v) => {
    if (v) n.due = v; else delete n.due;
    touch(n);
    save();
    el.refresh();
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
  pop.append(quick, when);
  pop.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePop(); } }; // Esc closes this, not the window
  sync();
  return pop;
}
document.addEventListener('pointerdown', (e) => {
  if (openPop && !openPop.contains(e.target) && !e.target.closest('.due')) closePop();
});
setInterval(refreshAll, 30000); // due states and ages move with the clock

function addNote() {
  notes.push(newNote());
  save();
  render(notes.length - 1);
}

function removeNote(n) {
  const idx = notes.indexOf(n);
  const removed = notes.splice(idx, 1)[0];
  if (!notes.length) notes.push(newNote()); // always keep one
  save();
  render(Math.min(idx, notes.length - 1));
  if (removed.text.trim()) toast('Note deleted', () => { // undo only matters if it had content
    notes.splice(idx, 0, removed);
    save();
    render(idx);
  });
}

function toast(msg, onUndo) {
  clearTimeout(toastTimer);
  $('toast-msg').textContent = msg;
  $('toast').hidden = false;
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

function control(key, spec) {
  const id = 's-' + key;
  if (spec.type === 'check') {
    const input = el('input', { type: 'checkbox', id });
    input.onchange = () => apply({ [key]: input.checked });
    return el('label', { className: 'check' }, input, spec.label);
  }
  if (spec.type === 'range') {
    const out = el('output', { id: id + '-out' });
    const input = el('input', { type: 'range', id, min: spec.min, max: spec.max, step: spec.step });
    input.oninput = () => { out.textContent = input.value + spec.unit; apply({ [key]: +input.value }); };
    return el('label', {}, el('span', {}, spec.label + ': ', out), input);
  }
  const select = el('select', { id }, ...Object.entries(spec.options).map(([v, t]) => el('option', { value: v, textContent: t })));
  select.onchange = () => apply({ [key]: select.value });
  return el('label', {}, spec.label, select);
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
  return el('label', {}, 'Shortcut', hk);
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

async function openSettings() {
  meta.schema = (await api.load()).schema; // monitor list may have changed
  const groups = {};
  for (const [key, spec] of Object.entries(meta.schema)) (groups[spec.group] ||= []).push(control(key, spec));
  $('settings-body').replaceChildren(...Object.entries(groups).map(([name, controls]) =>
    el('fieldset', {}, el('legend', { textContent: name }), ...(name === 'General' ? [hotkeyControl()] : []), ...controls)));
  syncControls();
  $('settings-err').textContent = '';
  disarmReset();
  $('settings').hidden = false;
  $('hotkey').focus();
}

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
$('add').onclick = addNote;
$('gear').onclick = openSettings;
$('close').onclick = () => api.hide();
$('pin').onclick = (e) => {
  const on = e.target.getAttribute('aria-pressed') !== 'true';
  e.target.setAttribute('aria-pressed', on);
  api.setPinned(on);
};

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') {
    if (!$('settings').hidden) $('settings').hidden = true;
    else api.hide();
  } else if (mod && e.key === 'n') { e.preventDefault(); addNote(); }
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

(async () => {
  const d = await api.load();
  ({ settings, notes } = d);
  meta = d;
  // older versions stored a hex colour; now an index into the chosen palette
  const classic = d.palettes.classic;
  for (const n of notes) if (typeof n.color !== 'number') n.color = Math.max(0, classic.indexOf(n.color));
  for (const n of notes) { n.created ??= Date.now(); n.updated ??= n.created; } // notes from before dates existed start fresh
  if (!notes.length) notes = [newNote()];
  render(0);
  applyStyle();
  save(); // persist the migration
})();
