const { app, BrowserWindow, Tray, Menu, Notification, globalShortcut, screen, nativeImage, nativeTheme, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const Time = require('./timeutil');

if (process.env.STICKYDROP_DATA) app.setPath('userData', process.env.STICKYDROP_DATA); // tests
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
let data = { version: VERSION, settings: { ...DEFAULTS }, notes: [], tabs: DEFAULT_TABS(), activeTab: 'main', labels: [], reminded: {} };
let win, tray, pinned = false, quitting = false, saveTimer, trayTimer;
const S = () => data.settings;

function load() {
  let raw;
  try { raw = fs.readFileSync(FILE(), 'utf8'); } catch { return; } // first run
  try {
    const d = JSON.parse(raw);
    const tabs = cleanTabs(d.tabs, d.columns);
    data = {
      version: VERSION,
      settings: { ...DEFAULTS, ...d.settings },
      notes: Array.isArray(d.notes) ? d.notes : [],
      tabs,
      activeTab: tabs.some((t) => t.id === d.activeTab) ? d.activeTab : tabs[0].id,
      labels: cleanLabels(d.labels),
      reminded: cleanReminded(d.reminded), // note id -> the due it was reminded for (main's own; the renderer never sends it)
    };
    for (const [k, spec] of Object.entries(SCHEMA)) { // drop stale/invalid saved values
      if (k !== 'display' && coerce(spec, S()[k]) === undefined) S()[k] = spec.def;
    }
    const was = Number.isInteger(d.version) ? d.version : 1; // only values still on the old default move
    if (was < 2 && S().theme === 'dark') S().theme = 'system';
    if (was < 2 && S().opacity === 100) S().opacity = 85;
    if (was < 3 && S().fontSize === 17) S().fontSize = 14;
  } catch {
    fs.renameSync(FILE(), FILE() + '.corrupt-' + Date.now()); // never overwrite unreadable notes
  }
}

function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const tmp = FILE() + '.tmp';
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE()); // atomic: a crash can't leave half a file
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
ipcMain.handle('reset-settings', () => applySettings(DEFAULTS)); // notes are untouched

// ---- lifecycle -------------------------------------------------------------
app.on('second-instance', (_e, argv) => (argv.includes('--toggle') ? toggle() : show()));
app.on('before-quit', () => { quitting = true; flush(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {}); // live in the tray

app.whenReady().then(() => {
  load();
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
  win.on('blur', () => { if (!pinned && S().hideOnBlur) win.hide(); });
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
