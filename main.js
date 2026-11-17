const { app, BrowserWindow, Tray, Menu, globalShortcut, screen, nativeImage, nativeTheme, shell, ipcMain } = require('electron');
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

const SCHEMA = {
  display:       { group: 'General', label: 'Show on', type: 'select', options: displayChoices, def: 'mouse' },
  hideOnBlur:    { group: 'General', label: 'Hide when focus is lost', type: 'check', def: true },
  refocus:       { group: 'General', label: 'Shortcut refocuses an unfocused window instead of hiding it', type: 'check', def: true },
  alwaysOnTop:   { group: 'General', label: 'Stay on top', type: 'check', def: true },
  showTray:      { group: 'General', label: 'Show tray icon', type: 'check', def: true },
  launchAtLogin: { group: 'General', label: 'Launch at login', type: 'check', def: false },
  widthPct:      { group: 'Window', label: 'Width', type: 'range', min: 20, max: 100, step: 5, unit: '%', def: 100 },
  heightPct:     { group: 'Window', label: 'Height (or drag the window edge)', type: 'range', min: 15, max: 100, step: 1, unit: '%', def: 40 },
  halign:        { group: 'Window', label: 'Horizontal position', type: 'select', options: { left: 'Left', center: 'Center', right: 'Right' }, def: 'center' },
  valign:        { group: 'Window', label: 'Drops from', type: 'select', options: { top: 'Top', bottom: 'Bottom' }, def: 'top' },
  markdown:      { group: 'Notes', label: 'Render Markdown when not editing', type: 'check', def: true },
  aging:         { group: 'Notes', label: 'Aging (from last edit)', type: 'select', options: { off: 'Off', fade: 'Fade (washes out)', vintage: 'Vintage (yellows, corner curls)' }, def: 'fade' },
  agingDays:     { group: 'Notes', label: 'Fully aged after', type: 'range', min: 1, max: 60, step: 1, unit: ' days', def: 14 },
  showAge:       { group: 'Notes', label: 'Show created / edited time', type: 'check', def: true },
  layout:        { group: 'Notes', label: 'Layout', type: 'select', options: { row: 'Row of notes', board: 'Kanban board (columns)' }, def: 'row' },
  noteWidth:     { group: 'Notes', label: 'Note width (row layout)', type: 'range', min: 260, max: 800, step: 10, unit: 'px', def: 420 },
  doneSink:      { group: 'Notes', label: 'Move notes to the end when marked done', type: 'check', def: false },
  theme:         { group: 'Appearance', label: 'Theme', type: 'select', options: { system: 'Follow system', dark: 'Dark', light: 'Light' }, def: 'dark' },
  opacity:       { group: 'Appearance', label: 'Background opacity', type: 'range', min: 30, max: 100, step: 5, unit: '%', def: 100 },
  palette:       { group: 'Appearance', label: 'Note colours', type: 'select', options: labels(PALETTES), def: 'classic' },
  font:          { group: 'Appearance', label: 'Font', type: 'select', options: labels(FONTS), def: 'hand' },
  fontSize:      { group: 'Appearance', label: 'Font size', type: 'range', min: 12, max: 32, step: 1, unit: 'px', def: 17 },
  showToolbar:   { group: 'Appearance', label: 'Show toolbar', type: 'check', def: true },
  animate:       { group: 'Appearance', label: 'Slide animation', type: 'check', def: true },
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
let data = { settings: { ...DEFAULTS }, notes: [], columns: DEFAULT_COLUMNS() };
let win, tray, pinned = false, quitting = false, saveTimer, trayTimer;
const S = () => data.settings;

function load() {
  let raw;
  try { raw = fs.readFileSync(FILE(), 'utf8'); } catch { return; } // first run
  try {
    const d = JSON.parse(raw);
    data = { settings: { ...DEFAULTS, ...d.settings }, notes: Array.isArray(d.notes) ? d.notes : [], columns: cleanColumns(d.columns) };
    for (const [k, spec] of Object.entries(SCHEMA)) { // drop stale/invalid saved values
      if (k !== 'display' && coerce(spec, S()[k]) === undefined) S()[k] = spec.def;
    }
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
      click: show,
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
// 'screen-saver' level keeps it above full-screen apps on macOS
const setOnTop = (on) => (on ? win.setAlwaysOnTop(true, 'screen-saver') : win.setAlwaysOnTop(false));

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
  columns: data.columns,
  schema: resolvedSchema(),
  palettes: Object.fromEntries(Object.entries(PALETTES).map(([k, v]) => [k, v.colors])),
  fonts: Object.fromEntries(Object.entries(FONTS).map(([k, v]) => [k, v.css])),
}));
ipcMain.on('save-notes', (_e, notes) => {
  if (!Array.isArray(notes)) return;
  data.notes = notes;
  scheduleSave();
  clearTimeout(trayTimer);
  trayTimer = setTimeout(buildTray, 1000); // keep the tray's due summary current
});
ipcMain.on('save-columns', (_e, cols) => { data.columns = cleanColumns(cols); scheduleSave(); });
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

  if (process.env.STICKYDROP_SHOW || process.argv.includes('--toggle')) show();
});
