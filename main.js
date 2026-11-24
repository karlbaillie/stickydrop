const { app, BrowserWindow, Tray, Menu, Notification, globalShortcut, screen, nativeImage, nativeTheme, shell, ipcMain,
  dialog, clipboard, protocol, net, session } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const Time = require('./timeutil');
const X = require('./exporter');
const Sync = require('./sync');

if (process.env.STICKYDROP_DATA) app.setPath('userData', process.env.STICKYDROP_DATA); // tests
// sdimg://a/NAME serves an attachment (a pasted or dropped image) from the notes' attachments folder
protocol.registerSchemesAsPrivileged([{ scheme: 'sdimg', privileges: { standard: true, secure: true } }]);
if (process.platform === 'linux') {
  // Wayland can't position/pin windows or grab global keys; XWayland can.
  app.commandLine.appendSwitch('ozone-platform', 'x11');
  if (process.env.APPIMAGE) app.commandLine.appendSwitch('no-sandbox'); // AppImage can't ship a setuid sandbox helper
}

// `stickydrop --toggle` from a system shortcut: the Wayland-proof way to summon the window
if (!app.requestSingleInstanceLock()) app.exit(0);

// ---- settings schema (single source: the renderer builds its form from this) ----
const PALETTES = {
  classic: { label: 'Classic', colors: ['#fff176', '#f8bbd0', '#b3e5fc', '#c5e1a5', '#ffcc80'] },
  pastel: { label: 'Pastel', colors: ['#fdfd96', '#ffd1dc', '#aec6cf', '#b5ead7', '#e0bbe4'] },
  earth: { label: 'Earth', colors: ['#f4e4c1', '#e6c9a8', '#d7e3b5', '#c9d9d3', '#e8c4c4'] },
  mono: { label: 'Mono', colors: ['#ffffff', '#eeeeee', '#dddddd', '#cccccc', '#bbbbbb'] },
};
const FONTS = {
  hand: { label: 'Handwriting', css: '"Segoe Print", "Comic Neue", "Comic Sans MS", system-ui, sans-serif' },
  sans: { label: 'Sans-serif', css: 'system-ui, sans-serif' },
  serif: { label: 'Serif', css: 'Georgia, "Times New Roman", serif' },
  mono: { label: 'Monospace', css: 'ui-monospace, "DejaVu Sans Mono", Consolas, monospace' },
};
const labels = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.label]));
const displayChoices = () => ({
  mouse: 'Display under the mouse',
  primary: 'Primary display',
  ...Object.fromEntries(screen.getAllDisplays().map((d, i) => [`id:${d.id}`, `Display ${i + 1} (${d.size.width}×${d.size.height})`])),
});

// group = the settings tab, section = a heading within it, hint = one line under the label. The order here is the order shown.
const SCHEMA = {
  // General (the shortcut itself is a custom control at the top of the tab)
  refocus:       { group: 'General', section: 'Shortcut', label: 'Refocus instead of hiding', type: 'check', def: true,
    hint: 'If the window is open but another app has focus, the shortcut brings it forward' },
  hideOnBlur:    { group: 'General', section: 'Behaviour', label: 'Hide when focus is lost', type: 'check', def: true,
    hint: 'Pin in the toolbar keeps it open for now' },
  alwaysOnTop:   { group: 'General', section: 'Behaviour', label: 'Stay on top of other windows', type: 'check', def: true },
  showTray:      { group: 'General', section: 'Behaviour', label: 'Show tray icon', type: 'check', def: true },
  launchAtLogin: { group: 'General', section: 'Behaviour', label: 'Launch at login', type: 'check', def: false },
  autoUpdate:    { group: 'General', section: 'Updates', label: 'Check for updates automatically', type: 'check', def: true,
    hint: 'Asks GitHub a few times a day. Windows and the Linux AppImage update when you quit; elsewhere you get a download link' },
  // Window
  display:       { group: 'Window', section: 'Position', label: 'Show on', type: 'select', options: displayChoices, def: 'mouse' },
  valign:        { group: 'Window', section: 'Position', label: 'Drops from', type: 'select', options: { top: 'Top', bottom: 'Bottom' }, def: 'top' },
  halign:        { group: 'Window', section: 'Position', label: 'Horizontal position', type: 'select', options: { left: 'Left', center: 'Center', right: 'Right' }, def: 'center',
    hint: 'When narrower than the screen' },
  widthPct:      { group: 'Window', section: 'Size', label: 'Width', type: 'range', min: 20, max: 100, step: 5, unit: '%', def: 100 },
  heightPct:     { group: 'Window', section: 'Size', label: 'Height', type: 'range', min: 15, max: 100, step: 1, unit: '%', def: 40,
    hint: 'Or drag the window\'s edge' },
  animate:       { group: 'Window', section: 'Motion', label: 'Slide in and out', type: 'check', def: true },
  // Appearance
  theme:         { group: 'Appearance', section: 'Window', label: 'Theme', type: 'select', options: { system: 'Follow system', dark: 'Dark', light: 'Light' }, def: 'system' },
  opacity:       { group: 'Appearance', section: 'Window', label: 'Background opacity', type: 'range', min: 30, max: 100, step: 5, unit: '%', def: 85 },
  showToolbar:   { group: 'Appearance', section: 'Window', label: 'Show toolbar', type: 'check', def: true,
    hint: 'Keyboard shortcuts still work without it' },
  palette:       { group: 'Appearance', section: 'Notes', label: 'Note colours', type: 'select', options: labels(PALETTES), def: 'classic' },
  font:          { group: 'Appearance', section: 'Notes', label: 'Font', type: 'select', options: labels(FONTS), def: 'hand' },
  fontSize:      { group: 'Appearance', section: 'Notes', label: 'Font size', type: 'range', min: 12, max: 32, step: 1, unit: 'px', def: 14 },
  // Notes
  layout:        { group: 'Notes', section: 'Layout', label: 'Default layout', type: 'select', options: { row: 'Row of notes', board: 'Kanban board' }, def: 'row',
    hint: 'For new tabs, and tabs not set with the toolbar\'s Layout button' },
  noteMinWidth:  { group: 'Notes', section: 'Layout', label: 'Minimum note width', type: 'range', min: 200, max: 600, step: 10, unit: 'px', def: 300,
    hint: 'Row layout: notes never squeeze narrower; past that the row scrolls' },
  noteWidth:     { group: 'Notes', section: 'Layout', label: 'Maximum note width', type: 'range', min: 260, max: 800, step: 10, unit: 'px', def: 420,
    hint: 'Row layout: the most a note stretches (never below the minimum)' },
  doneSink:      { group: 'Notes', section: 'Layout', label: 'Move done notes to the end', type: 'check', def: false, hint: 'Row layout' },
  markdown:      { group: 'Notes', section: 'Content', label: 'Render Markdown', type: 'check', def: true, hint: 'While a note isn\'t being edited' },
  webImages:     { group: 'Notes', section: 'Content', label: 'Load web images', type: 'check', def: true,
    hint: 'Images linked from the web (https). Off: they show as links and nothing is fetched' },
  showAge:       { group: 'Notes', section: 'Content', label: 'Show created and edited times', type: 'check', def: true },
  aging:         { group: 'Notes', section: 'Aging', label: 'Aging', type: 'select', options: { off: 'Off', fade: 'Fade (washes out)', vintage: 'Vintage (yellows, corner curls)' }, def: 'fade',
    hint: 'Notes change the longer they go unedited' },
  agingDays:     { group: 'Notes', section: 'Aging', label: 'Fully aged after', type: 'range', min: 1, max: 60, step: 1, unit: ' days', def: 14 },
  // Reminders
  reminders:     { group: 'Reminders', section: 'Notifications', label: 'Desktop reminders', type: 'check', def: true,
    hint: 'For notes due at a set time, while StickyDrop is running' },
  reminderLead:  { group: 'Reminders', section: 'Notifications', label: 'Remind me', type: 'select', def: '10',
    options: { 0: 'At the due time', 5: '5 minutes before', 10: '10 minutes before', 15: '15 minutes before', 30: '30 minutes before', 60: '1 hour before' } },
};
const optionsOf = (spec) => (typeof spec.options === 'function' ? spec.options() : spec.options);

const DEFAULTS = {
  hotkey: process.platform === 'darwin' ? 'Control+Alt+N' : 'F9',
  ...Object.fromEntries(Object.entries(SCHEMA).map(([k, s]) => [k, s.def])),
};

// returns the cleaned value, or undefined if invalid
function coerce(spec, v) {
  if (spec.type === 'check') return typeof v === 'boolean' ? v : undefined;
  if (spec.type === 'range') {
    if (!Number.isFinite(v)) return undefined;
    return Math.min(spec.max, Math.max(spec.min, Math.round(v / spec.step) * spec.step));
  }
  return typeof v === 'string' && Object.hasOwn(optionsOf(spec), v) ? v : undefined;
}

// ---- state -----------------------------------------------------------------
const FILE = () => path.join(app.getPath('userData'), 'data.json');
const DEFAULT_COLUMNS = () => [{ id: 'todo', name: 'To do' }, { id: 'doing', name: 'Doing' }, { id: 'done', name: 'Done', done: true }];
// 1-8 columns with unique string ids and non-empty names, else the defaults
function cleanColumns(c) {
  if (!Array.isArray(c) || !c.length || c.length > 8) return DEFAULT_COLUMNS();
  const ids = new Set();
  const out = [];
  for (const x of c) {
    const name = typeof x?.name === 'string' ? x.name.trim().slice(0, 30) : '';
    if (!name || typeof x.id !== 'string' || !x.id || ids.has(x.id)) return DEFAULT_COLUMNS();
    ids.add(x.id);
    const col = { id: x.id, name };
    if (x.done) col.done = true;
    if (x.collapsed) col.collapsed = true;
    if (Number.isInteger(x.color) && x.color >= 0 && x.color < 6) col.color = x.color;
    if (Number.isInteger(x.limit) && x.limit >= 1 && x.limit <= 99) col.limit = x.limit;
    out.push(col);
  }
  return out;
}
// Tabs: separate sets of notes, each with its own Kanban columns. Up to 12, unique ids, non-empty names; bad entries are
// dropped, and with none left (or a file from before tabs) the old top-level `columns` become the first tab.
const DEFAULT_TABS = (cols) => [{ id: 'main', name: 'Notes', columns: cleanColumns(cols) }];
function cleanTabs(t, legacyColumns) {
  if (!Array.isArray(t)) return DEFAULT_TABS(legacyColumns);
  const ids = new Set();
  const out = [];
  for (const x of t.slice(0, 12)) {
    const name = typeof x?.name === 'string' ? x.name.trim().slice(0, 24) : '';
    if (!name || typeof x.id !== 'string' || !x.id || ids.has(x.id)) continue;
    ids.add(x.id);
    const tab = { id: x.id, name, columns: cleanColumns(x.columns) };
    if (x.layout === 'row' || x.layout === 'board') tab.layout = x.layout; // else the default layout setting
    out.push(tab);
  }
  return out.length ? out : DEFAULT_TABS(legacyColumns);
}
// Labels: named coloured tags shared by every tab. Up to 24, colour = index into the renderer's label colours.
function cleanLabels(l) {
  if (!Array.isArray(l)) return [];
  const ids = new Set();
  return l.slice(0, 24).flatMap((x) => {
    const name = typeof x?.name === 'string' ? x.name.trim().slice(0, 24) : '';
    if (!name || typeof x.id !== 'string' || !x.id || ids.has(x.id)) return [];
    ids.add(x.id);
    return [{ id: x.id, name, color: Number.isInteger(x.color) && x.color >= 0 && x.color < 6 ? x.color : 0 }];
  });
}
const cleanReminded = (r) => Object.fromEntries(Object.entries(r && typeof r === 'object' ? r : {}).filter(([, v]) => typeof v === 'string'));

// Saved files hold every setting, so a changed default only reaches existing installs through a one-time move here.
// 2: theme follows the system, opacity 85%. 3: font size 14px.
const VERSION = 3;
let data = { version: VERSION, settings: { ...DEFAULTS }, notes: [], tabs: DEFAULT_TABS(), activeTab: 'main', labels: [], reminded: {} }; // + syncDir
let win, tray, pinned = false, quitting = false, saveTimer, trayTimer;
let modal = 0; // a native dialog or menu is open: losing focus to it must not hide the window
const S = () => data.settings;

// ---- storage -----------------------------------------------------------------
// The local file (userData/data.json) always holds everything, settings included. With a sync folder set, the notes
// (notes, tabs, labels) are also written to <folder>/data.json and read from there at startup, so they follow you
// between computers; settings, the active tab and reminder history stay on each computer. If the folder is missing
// (not mounted, not synced yet), the local copy is used and nothing is written there until the next start.
const SHARED_KEYS = ['notes', 'tabs', 'labels'];
const sharedFile = () => path.join(data.syncDir, 'data.json');
let syncOk = false; // the sync folder is set and was there at startup
let lastShared = ''; // the shared file's text as we last wrote or read it, so the watcher ignores our own writes
const attachDir = () => path.join(syncOk ? data.syncDir : app.getPath('userData'), 'attachments');

function readJson(file) { // null if missing; a file that won't parse is moved aside and never overwritten
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  try { return { d: JSON.parse(raw), raw }; } catch { fs.renameSync(file, file + '.corrupt-' + Date.now()); return null; }
}
// the notes part of a file, cleaned
const sharedPart = (d) => {
  const tabs = cleanTabs(d.tabs, d.columns);
  return { notes: Array.isArray(d.notes) ? d.notes : [], tabs, labels: cleanLabels(d.labels) };
};

function load() {
  const local = readJson(FILE());
  if (!local) return; // first run (or a corrupt file, moved aside)
  const d = local.d;
  data = {
    version: VERSION,
    settings: { ...DEFAULTS, ...d.settings },
    ...sharedPart(d),
    activeTab: d.activeTab,
    reminded: cleanReminded(d.reminded), // note id -> the due it was reminded for (main's own; the renderer never sends it)
  };
  if (typeof d.syncDir === 'string' && path.isAbsolute(d.syncDir)) data.syncDir = d.syncDir;
  for (const [k, spec] of Object.entries(SCHEMA)) { // drop stale/invalid saved values
    if (k !== 'display' && coerce(spec, S()[k]) === undefined) S()[k] = spec.def;
  }
  const was = Number.isInteger(d.version) ? d.version : 1; // only values still on the old default move
  if (was < 2 && S().theme === 'dark') S().theme = 'system';
  if (was < 2 && S().opacity === 100) S().opacity = 85;
  if (was < 3 && S().fontSize === 17) S().fontSize = 14;
  if (data.syncDir) {
    syncOk = fs.existsSync(data.syncDir);
    const shared = syncOk && readJson(sharedFile());
    if (shared) { Object.assign(data, sharedPart(shared.d)); lastShared = shared.raw; }
  }
  if (!data.tabs.some((t) => t.id === data.activeTab)) data.activeTab = data.tabs[0].id;
}

function writeAtomic(file, text) {
  const tmp = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file); // atomic: a crash can't leave half a file
}
const sharedText = () => JSON.stringify({ version: VERSION, ...Object.fromEntries(SHARED_KEYS.map((k) => [k, data[k]])) }, null, 2);
// Take in another computer's save (raw = the folder file's text): three-way merge against what we last wrote or read
// there, so neither side's changes are lost. Returns true if this computer's notes changed.
function absorb(raw) {
  let d;
  try { d = JSON.parse(raw); } catch { return false; } // half-synced: the next event brings the rest
  let base = null;
  try { if (lastShared) base = sharedPart(JSON.parse(lastShared)); } catch { /* none */ }
  const local = Object.fromEntries(SHARED_KEYS.map((k) => [k, data[k]]));
  const merged = Sync.merge(base, local, sharedPart(d));
  lastShared = raw;
  if (Sync.same(merged, local)) return false;
  Object.assign(data, merged);
  if (!data.tabs.some((t) => t.id === data.activeTab)) data.activeTab = data.tabs[0].id;
  return true;
}
const tellRenderer = (why) => { win?.webContents.send('data-changed', { ...boardData(), why }); buildTray(); };

function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (syncOk) { // the folder changed since we last looked (and the watcher hasn't caught up): merge before writing
    let disk = null;
    try { disk = fs.readFileSync(sharedFile(), 'utf8'); } catch { /* not there yet */ }
    if (disk != null && disk !== lastShared && absorb(disk)) tellRenderer('Notes updated from another computer');
  }
  writeAtomic(FILE(), JSON.stringify(data, null, 2));
  if (!syncOk) return;
  const text = sharedText();
  if (text === lastShared) return;
  try { // same notes in a different form (another app version wrote it): leave it, or two computers rewrite forever
    if (lastShared && Sync.same(sharedPart(JSON.parse(lastShared)), sharedPart(JSON.parse(text)))) return;
  } catch { /* unreadable: write ours */ }
  try { writeAtomic(sharedFile(), text); lastShared = text; } catch (e) { console.error('sync folder write failed:', e.message); }
}

// another computer changed the shared file (via Dropbox, Syncthing...): take its notes and redraw
let watcher, watchTimer;
function watchShared() {
  watcher?.close();
  watcher = null;
  if (!syncOk) return;
  try {
    watcher = fs.watch(data.syncDir, (_ev, f) => {
      if (f && f !== 'data.json') return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        let raw;
        try { raw = fs.readFileSync(sharedFile(), 'utf8'); } catch { return; }
        if (raw === lastShared) return; // our own write, or nothing new
        if (absorb(raw)) tellRenderer('Notes updated from another computer');
        flush(); // keep the local copy current, and write the merge back if it differs from what arrived
      }, 400);
    });
  } catch (e) { console.error('cannot watch the sync folder:', e.message); }
}
const boardData = () => ({ notes: data.notes, tabs: data.tabs, activeTab: data.activeTab, labels: data.labels });

// copy image files between folders (moving to/from a sync folder); existing files are left alone
function copyAttachments(from, to) {
  let names = [];
  try { names = fs.readdirSync(from).filter((f) => X.NAME_RE.test(f)); } catch { return; }
  fs.mkdirSync(to, { recursive: true });
  for (const f of names) if (!fs.existsSync(path.join(to, f))) fs.copyFileSync(path.join(from, f), path.join(to, f));
}
// delete images no note refers to any more (archived notes count), once a week old: a synced folder may receive a
// new image before the notes file that refers to it
function collectAttachments() {
  const used = new Set(data.notes.flatMap((n) => X.attachmentsIn(n.text)));
  const dir = attachDir();
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const f of names) {
    if (!X.NAME_RE.test(f) || used.has(f)) continue;
    try { if (Date.now() - fs.statSync(path.join(dir, f)).mtimeMs > 7 * 864e5) fs.rmSync(path.join(dir, f)); } catch { /* gone already */ }
  }
}

const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 300); };

// ---- window ----------------------------------------------------------------
function pickDisplay() {
  const d = S().display;
  if (d === 'primary') return screen.getPrimaryDisplay();
  if (typeof d === 'string' && d.startsWith('id:')) {
    const found = screen.getAllDisplays().find((x) => `id:${x.id}` === d);
    if (found) return found;
  }
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()); // also the fallback if a monitor was unplugged
}

// below ~120px the settings form can't fit, so small displays get a pixel floor under the % minimum
const MIN_H = 140;
const clampH = (a, h) => Math.round(Math.min(a.height, Math.max(MIN_H, h)));
function place() {
  const a = pickDisplay().workArea;
  const w = Math.round((a.width * S().widthPct) / 100);
  const h = clampH(a, (a.height * S().heightPct) / 100);
  const x = S().halign === 'left' ? a.x : S().halign === 'right' ? a.x + a.width - w : a.x + Math.round((a.width - w) / 2);
  const y = S().valign === 'bottom' ? a.y + a.height - h : a.y;
  win.setBounds({ x, y, width: w, height: h });
}

function show() {
  place();
  win.show();
  win.focus();
  win.webContents.send('show');
}

// visible but unfocused (pinned, or another app took focus): refocus first, like Guake's window-refocus
const toggle = () => {
  if (!win.isVisible()) show();
  else if (!win.isFocused() && S().refocus) { win.focus(); win.webContents.send('show'); }
  else win.hide();
};

// ---- hotkey / autostart / tray ---------------------------------------------
function bind(key) {
  globalShortcut.unregisterAll();
  try { return globalShortcut.register(key, toggle); } catch { return false; } // bad accelerator throws
}

function setHotkey(key) {
  const old = S().hotkey;
  if (bind(key)) return true;
  bind(old);
  return false;
}

function applyAutostart(on) {
  if (process.platform === 'linux') {
    const f = path.join(app.getPath('home'), '.config', 'autostart', 'stickydrop.desktop');
    if (!on) return fs.rmSync(f, { force: true });
    const exec = process.env.APPIMAGE || process.execPath;
    const args = app.isPackaged ? '' : ` "${app.getAppPath()}" --no-sandbox`;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `[Desktop Entry]\nType=Application\nName=StickyDrop\nExec="${exec}"${args}\nX-GNOME-Autostart-enabled=true\n`);
  } else {
    app.setLoginItemSettings({ openAtLogin: on });
  }
}

function buildTray() {
  if (!tray) return;
  const now = new Date();
  const sum = Time.summarize(data.notes, now);
  const parts = [sum.overdue && `${sum.overdue} overdue`, sum.today && `${sum.today} due today`].filter(Boolean);
  const headline = parts.length ? parts.join(', ') : 'Nothing due';
  tray.setToolTip(parts.length ? `StickyDrop: ${headline}` : 'StickyDrop');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: headline, enabled: false },
    ...sum.items.slice(0, 6).map(({ note, state }) => ({
      label: `${state === 'overdue' ? '⚠ ' : ''}${Time.noteTitle(note.text)} — ${Time.dueLabel(note.due, now)}`,
      click: () => focusNote(note.id),
    })),
    { type: 'separator' },
    { label: `Show / hide (${S().hotkey})`, click: toggle },
    ...(update.ready ? [{ label: `Restart to update to ${update.version}`, click: () => updater.quitAndInstall() }]
      : update.version ? [{ label: `Download StickyDrop ${update.version}…`, click: () => shell.openExternal(releaseUrl(update.version)) }]
        : updater ? [{ label: 'Check for updates', click: () => checkForUpdates(true) }] : []),
    { label: 'Quit StickyDrop', click: () => app.quit() },
  ]));
}
function setTray(on) {
  if (on && !tray) {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 18, height: 18 }));
    tray.setToolTip('StickyDrop');
    tray.on('click', toggle);
    buildTray();
  } else if (!on && tray) {
    tray.destroy();
    tray = null;
  }
}
// show the window on the note's tab with that note focused (tray items, reminder clicks)
function focusNote(id) {
  show();
  win.webContents.send('focus-note', id);
}

// ---- reminders -------------------------------------------------------------
// Only while the app runs (it lives in the tray). Each note is reminded once per due value; changing the due (or a
// recurring note rolling forward) arms it again.
const shown = new Set(); // keep notifications referenced until closed, or their click handler can be collected
const sentReminders = []; // the last few, for the end-to-end suite
function checkReminders() {
  if (!S().reminders) return;
  const now = new Date();
  const due = Time.remindersDue(data.notes, data.reminded, now, Number(S().reminderLead));
  for (const n of due) {
    data.reminded[n.id] = n.due;
    const tab = data.tabs.length > 1 ? data.tabs.find((t) => t.id === n.tab) : null;
    const body = `Due ${Time.dueLabel(n.due, now)}${tab ? ` · ${tab.name}` : ''}`;
    sentReminders.push({ id: n.id, title: Time.noteTitle(n.text), body });
    sentReminders.splice(0, sentReminders.length - 20);
    if (!Notification.isSupported() || process.env.STICKYDROP_NO_NOTIFY) continue; // the test suite records, never pops up
    const note = new Notification({ title: Time.noteTitle(n.text), body });
    shown.add(note);
    note.on('click', () => focusNote(n.id));
    note.on('close', () => shown.delete(note));
    note.show();
  }
  if (due.length) scheduleSave();
}
globalThis.stickydropReminders = sentReminders;

// 'pop-up-menu' is the highest level at which macOS still delivers drag-and-drop events to the window: at 'screen-saver'
// a drag starts but no dragover/drop ever arrives (tested on macOS 26 with every level). It is still above the menu bar
// and Dock; full-screen apps are covered by setVisibleOnAllWorkspaces({ visibleOnFullScreen }).
const setOnTop = (on) => (on ? win.setAlwaysOnTop(true, 'pop-up-menu') : win.setAlwaysOnTop(false));

// side effects of a setting changing (the rest is pure CSS in the renderer)
const APPLY = {
  alwaysOnTop: setOnTop,
  showTray: setTray,
  theme: (v) => { nativeTheme.themeSource = v; },
  launchAtLogin: applyAutostart,
};
const GEOMETRY = new Set(['display', 'widthPct', 'heightPct', 'halign', 'valign']);

// ---- IPC -------------------------------------------------------------------
const resolvedSchema = () => Object.fromEntries(Object.entries(SCHEMA).map(([k, s]) => [k, { ...s, options: s.options && optionsOf(s) }]));

ipcMain.handle('load', () => ({
  settings: data.settings,
  notes: data.notes,
  tabs: data.tabs,
  activeTab: data.activeTab,
  labels: data.labels,
  schema: resolvedSchema(),
  palettes: Object.fromEntries(Object.entries(PALETTES).map(([k, v]) => [k, v.colors])),
  fonts: Object.fromEntries(Object.entries(FONTS).map(([k, v]) => [k, v.css])),
}));
ipcMain.on('save-notes', (_e, notes) => {
  if (!Array.isArray(notes)) return;
  data.notes = notes;
  scheduleSave();
  const ids = new Set(notes.map((n) => n?.id));
  for (const id of Object.keys(data.reminded)) if (!ids.has(id)) delete data.reminded[id]; // forget deleted notes
  clearTimeout(trayTimer);
  trayTimer = setTimeout(() => { buildTray(); checkReminders(); }, 1000); // tray summary and reminders follow edits
});
// tabs (with their columns), the active tab and the label list
ipcMain.on('save-board', (_e, b) => {
  if (!b || typeof b !== 'object') return;
  data.tabs = cleanTabs(b.tabs, undefined);
  data.activeTab = data.tabs.some((t) => t.id === b.activeTab) ? b.activeTab : data.tabs[0].id;
  data.labels = cleanLabels(b.labels);
  scheduleSave();
});
// drag-to-resize from the renderer's edge grip: live while dragging, saved (as a % of the work area) on release
ipcMain.handle('resize-height', (_e, px, commit) => {
  if (!Number.isFinite(px)) return { settings: S() };
  const a = pickDisplay().workArea;
  const h = clampH(a, Math.max(a.height * SCHEMA.heightPct.min / 100, px));
  win.setBounds({ ...win.getBounds(), height: h, y: S().valign === 'bottom' ? a.y + a.height - h : a.y });
  return commit ? applySettings({ heightPct: Math.round(h / a.height * 100) }) : { settings: S() };
});
ipcMain.on('pinned', (_e, v) => { pinned = !!v; });
ipcMain.on('hide', () => win.hide());
ipcMain.on('quit', () => app.quit());
function applySettings(patch) {
  let geometry = false;
  let error;
  for (const [k, spec] of Object.entries(SCHEMA)) {
    if (!(k in patch)) continue;
    const v = coerce(spec, patch[k]);
    if (v === undefined || v === S()[k]) continue;
    try { APPLY[k]?.(v); } catch (e) { error ||= e.message; continue; }
    S()[k] = v;
    geometry ||= GEOMETRY.has(k);
  }
  // hotkey last: if it's taken, every other setting has still been applied
  if (patch.hotkey !== undefined && patch.hotkey !== S().hotkey) {
    if (typeof patch.hotkey === 'string' && setHotkey(patch.hotkey)) { S().hotkey = patch.hotkey; buildTray(); }
    else error ||= 'That shortcut is taken or invalid.';
  }
  scheduleSave();
  if (geometry && win.isVisible()) place();
  return { ok: !error, error, settings: S() };
}
ipcMain.handle('set-settings', (_e, patch) => applySettings(patch));

// ---- updates ---------------------------------------------------------------
// electron-updater reads the GitHub release's latest*.yml. Windows (NSIS) and the Linux AppImage download the new
// version in the background and install it on quit. A Mac build that isn't signed with a Developer ID can't replace
// itself (macOS refuses an update from a different signer), and a .deb needs a package manager, so those announce the
// new version and link to its download page. Snap Store installs update themselves; runs from source don't check.
const REPO_URL = 'https://github.com/karlbaillie/stickydrop';
const releaseUrl = (v) => `${REPO_URL}/releases/tag/v${v}`;
const canInstall = () => process.platform === 'win32' || !!process.env.APPIMAGE;
let updater = null; // electron-updater's autoUpdater, in installed builds only
const update = { version: null, ready: false, told: null }; // the newest version found, and whether it's downloaded
function setupUpdates() {
  if (!app.isPackaged || process.env.SNAP || (process.env.STICKYDROP_DATA && !process.env.STICKYDROP_TEST_UPDATES)) return;
  try { ({ autoUpdater: updater } = require('electron-updater')); } catch { return; }
  updater.autoDownload = canInstall();
  updater.autoInstallOnAppQuit = true;
  updater.logger = null;
  updater.on('update-available', (i) => { update.version = i.version; if (!canInstall()) announce(); else buildTray(); });
  updater.on('update-downloaded', (i) => { Object.assign(update, { version: i.version, ready: true }); announce(); });
  updater.on('error', () => {}); // offline, private repo, rate-limited: the next check tries again
  setTimeout(() => S().autoUpdate && checkForUpdates(false), 30e3);
  setInterval(() => S().autoUpdate && checkForUpdates(false), 6 * 36e5);
}
// once per version: a notification, and the tray menu offers it
function announce() {
  buildTray();
  if (update.told === update.version + update.ready || !Notification.isSupported()) return;
  update.told = update.version + update.ready;
  const n = update.ready
    ? new Notification({ title: `StickyDrop ${update.version} is ready`, body: 'It installs when you quit. Click to restart now.' })
    : new Notification({ title: `StickyDrop ${update.version} is available`, body: 'Click to open the download page.' });
  shown.add(n);
  n.on('click', () => (update.ready ? updater.quitAndInstall() : shell.openExternal(releaseUrl(update.version))));
  n.on('close', () => shown.delete(n));
  n.show();
}
// manual = from Settings or the tray: report the outcome, even "up to date"
async function checkForUpdates(manual) {
  if (!updater) return { status: 'unsupported' };
  try {
    const r = await updater.checkForUpdates();
    const newer = r?.isUpdateAvailable ?? (r?.updateInfo?.version && r.updateInfo.version !== app.getVersion());
    if (!newer) {
      if (manual && Notification.isSupported()) new Notification({ title: 'StickyDrop is up to date', body: `Version ${app.getVersion()}` }).show();
      return { status: 'latest', version: app.getVersion() };
    }
    return { status: update.ready ? 'ready' : canInstall() ? 'downloading' : 'available', version: r.updateInfo.version };
  } catch (e) {
    return { status: 'error', error: /404|Unable to find latest/i.test(e.message) ? 'No releases found (is the repository public?)' : 'Could not reach GitHub' };
  }
}
ipcMain.handle('check-updates', () => checkForUpdates(true));
ipcMain.handle('update-info', () => ({ current: app.getVersion(), supported: !!updater, installs: canInstall(), version: update.version, ready: update.ready }));
ipcMain.on('open-release', () => update.version && shell.openExternal(releaseUrl(update.version)));
ipcMain.on('install-update', () => update.ready && updater.quitAndInstall());

// ---- images, export / import, sync folder ----------------------------------
// While a native dialog or menu is up the window loses focus to it; that must not hide it.
async function withModal(fn) {
  modal++;
  try { return await fn(); } finally { modal--; if (win.isVisible()) win.focus(); }
}
const today = () => Time.toDateStr(new Date());

// a pasted or dropped image: stored in the attachments folder under a random name; the note refers to that name
ipcMain.handle('save-attachment', (_e, bytes, type) => {
  const ext = X.IMAGE_TYPES[type];
  if (!ext || !(bytes instanceof Uint8Array || bytes instanceof ArrayBuffer)) return { error: 'Only PNG, JPEG, GIF and WebP images can be added.' };
  const buf = Buffer.from(bytes);
  if (buf.length > 15 * 2 ** 20) return { error: 'That image is over 15 MB.' };
  const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  fs.mkdirSync(attachDir(), { recursive: true });
  fs.writeFileSync(path.join(attachDir(), name), buf);
  return { name };
});
ipcMain.on('open-attachment', (_e, name) => { if (X.NAME_RE.test(name)) shell.openPath(path.join(attachDir(), name)); });

// copy a note's (or notes') images into <dir>/attachments next to an exported Markdown file
function exportImages(notes, dir) {
  const names = [...new Set(notes.flatMap((n) => X.attachmentsIn(n.text)))];
  for (const f of names) {
    const from = path.join(attachDir(), f);
    if (!fs.existsSync(from)) continue;
    fs.mkdirSync(path.join(dir, 'attachments'), { recursive: true });
    fs.copyFileSync(from, path.join(dir, 'attachments', f));
  }
}
const layoutOfTab = (t) => t.layout || S().layout;

// every tab as its own Markdown file in a chosen folder
ipcMain.handle('export-markdown', () => withModal(async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Export notes as Markdown', buttonLabel: 'Export here',
    properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  const dir = r.filePaths[0];
  const now = new Date();
  const used = new Set();
  const files = data.tabs.map((t) => {
    let name = X.safeName(t.name, 'Notes');
    while (used.has(name.toLowerCase())) name += ' (2)';
    used.add(name.toLowerCase());
    fs.writeFileSync(path.join(dir, name + '.md'), X.tabMarkdown(t, data.notes, data.labels, now, layoutOfTab(t)));
    return name + '.md';
  });
  exportImages(data.notes, dir);
  return { files, dir };
}));
// a full backup: everything in the data file, settings included
ipcMain.handle('export-backup', () => withModal(async () => {
  const r = await dialog.showSaveDialog(win, { title: 'Export a backup', defaultPath: `stickydrop-backup-${today()}.json`,
    filters: [{ name: 'StickyDrop backup', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return { canceled: true };
  fs.writeFileSync(r.filePath, JSON.stringify({ ...data, syncDir: undefined }, null, 2));
  return { file: r.filePath };
}));
// Markdown or text files: returned to the renderer, which adds one note per file to the current tab
ipcMain.handle('import-markdown', () => withModal(async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Import Markdown or text files', buttonLabel: 'Import',
    properties: ['openFile', 'multiSelections'], filters: [{ name: 'Markdown or text', extensions: ['md', 'markdown', 'txt'] }] });
  if (r.canceled) return { canceled: true };
  const files = [], skipped = [];
  for (const f of r.filePaths) {
    try {
      if (fs.statSync(f).size > 2 ** 20) { skipped.push(path.basename(f)); continue; } // 1 MB of text is plenty for a note
      const text = fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
      if (text) files.push({ name: path.basename(f).replace(/\.[^.]+$/, ''), text });
    } catch { skipped.push(path.basename(f)); }
  }
  return { files, skipped };
}));
// restore a backup: its notes, tabs and labels replace the current ones (settings stay); a safety copy is kept first
ipcMain.handle('restore-backup', () => withModal(async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Restore a StickyDrop backup', buttonLabel: 'Restore',
    properties: ['openFile'], filters: [{ name: 'StickyDrop backup', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  let d;
  try { d = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch { return { error: 'That file isn\'t a StickyDrop backup (it won\'t parse).' }; }
  if (!d || !Array.isArray(d.notes)) return { error: 'That file isn\'t a StickyDrop backup (it has no notes).' };
  flush(); // so there is a current file to keep
  const safety = FILE() + '.before-restore-' + Date.now();
  fs.copyFileSync(FILE(), safety);
  Object.assign(data, sharedPart(d));
  data.activeTab = data.tabs[0].id;
  flush();
  win.webContents.send('data-changed', { ...boardData(), why: `Restored ${data.notes.length} notes` });
  buildTray();
  return { notes: data.notes.length, safety };
}));

// sync folder: where the notes live so they follow you between computers
const dataInfo = () => ({ syncDir: data.syncDir || null, syncOk, dataDir: syncOk ? data.syncDir : app.getPath('userData') });
ipcMain.handle('data-info', dataInfo);
ipcMain.on('open-data-folder', () => shell.openPath(dataInfo().dataDir));
// step 1: pick a folder; if it already holds StickyDrop notes the renderer asks whose to keep
ipcMain.handle('choose-sync-dir', () => withModal(async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Keep notes in a folder', buttonLabel: 'Use this folder',
    message: 'Pick a folder that Dropbox, Syncthing, iCloud Drive or similar keeps in sync.', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  const dir = r.filePaths[0];
  let theirs = null;
  try { const d = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8')); if (Array.isArray(d.notes)) theirs = d.notes.filter((n) => !n.archived).length; } catch { /* none */ }
  return { dir, theirs };
}));
// step 2: start using it. 'mine' writes these notes there; 'theirs' takes the notes already in the folder
ipcMain.handle('set-sync-dir', (_e, dir, mode) => {
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || !fs.existsSync(dir)) return { error: 'That folder is not available.' };
  const before = attachDir();
  if (mode === 'theirs') {
    const shared = readJson(path.join(dir, 'data.json'));
    if (!shared) return { error: 'The notes in that folder can\'t be read.' };
    Object.assign(data, sharedPart(shared.d));
    if (!data.tabs.some((t) => t.id === data.activeTab)) data.activeTab = data.tabs[0].id;
    lastShared = shared.raw;
  } else lastShared = '';
  data.syncDir = dir;
  syncOk = true;
  copyAttachments(before, attachDir()); // images go along
  flush();
  watchShared();
  if (mode === 'theirs') win.webContents.send('data-changed', { ...boardData(), why: 'Now using the notes in the sync folder' });
  buildTray();
  return dataInfo();
});
// stop: the notes stay on this computer (the local copy is always current); images come back too
ipcMain.handle('stop-sync', () => {
  if (syncOk) copyAttachments(attachDir(), path.join(app.getPath('userData'), 'attachments'));
  delete data.syncDir;
  syncOk = false;
  watchShared();
  flush();
  return dataInfo();
});

// right-click on a note: copy / export it, move it to another tab, archive it
ipcMain.handle('note-menu', (_e, note, tabs) => withModal(async () => {
  const action = await new Promise((resolve) => {
    let picked = null;
    const pick = (v) => () => { picked = v; };
    const menu = Menu.buildFromTemplate([
      { label: 'Copy as Markdown', click: () => { clipboard.writeText(X.noteMarkdown(note, data.labels, new Date(), attachDir())); picked = 'copied'; } },
      { label: 'Export as Markdown file…', click: pick('export') },
      { type: 'separator' },
      tabs.length
        ? { label: 'Move to tab', submenu: tabs.map((t) => ({ label: t.name, click: pick('move:' + t.id) })) }
        : { label: 'Move to tab', enabled: false },
      { label: 'Archive', click: pick('archive') },
    ]);
    menu.popup({ window: win, callback: () => setTimeout(() => resolve(picked), 0) }); // after the item's click handler
  });
  if (action !== 'export') return action;
  const r = await dialog.showSaveDialog(win, { title: 'Export note', defaultPath: X.safeName(Time.noteTitle(note.text)) + '.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, X.noteMarkdown(note, data.labels, new Date()) + '\n');
  exportImages([note], path.dirname(r.filePath));
  return 'exported';
}));
ipcMain.handle('reset-settings', () => applySettings(DEFAULTS)); // notes are untouched

// ---- lifecycle -------------------------------------------------------------
app.on('second-instance', (_e, argv) => (argv.includes('--toggle') ? toggle() : show()));
app.on('before-quit', () => { quitting = true; flush(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {}); // live in the tray

app.whenReady().then(() => {
  load();
  protocol.handle('sdimg', (req) => {
    const name = decodeURIComponent(new URL(req.url).pathname.slice(1));
    if (!X.NAME_RE.test(name)) return new Response('', { status: 404 });
    return net.fetch(pathToFileURL(path.join(attachDir(), name)).toString());
  });
  watchShared();
  collectAttachments();
  // "Load web images" off: no image is fetched from the web, whatever a note contains
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (d, cb) =>
    cb({ cancel: d.resourceType === 'image' && !S().webImages }));
  setupUpdates();
  if (process.platform === 'darwin') app.dock.hide();

  win = new BrowserWindow({
    show: false, frame: false, transparent: true, skipTaskbar: true, resizable: false, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  setOnTop(S().alwaysOnTop);
  nativeTheme.themeSource = S().theme;
  win.loadFile('index.html');
  // Markdown links open in the real browser; the window itself never navigates
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('blur', () => { if (!pinned && !modal && S().hideOnBlur) win.hide(); });
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } }); // Alt+F4 hides, tray quits

  if (!bind(S().hotkey)) {
    // saved key now taken by something else: fall back so the app stays reachable
    S().hotkey = DEFAULTS.hotkey;
    bind(DEFAULTS.hotkey);
  }
  setTray(S().showTray);
  setInterval(buildTray, 60000); // due/overdue changes with the clock
  setInterval(checkReminders, 20000);
  checkReminders();

  if (process.env.STICKYDROP_SHOW || process.argv.includes('--toggle')) show();
});
