// Regenerates the README screenshots (docs/*.jpg) and, on macOS with ffmpeg, the drop-down animation (docs/drop.gif),
// from sample data in a throwaway profile (never your real notes). Run: just screenshots   (needs a display)
// `node scripts/screenshots.js gif` re-records only the GIF.
// macOS: full-desktop shots taken with scripts/capture.swift (ScreenCaptureKit), which leaves every other app's windows
// out, so whatever you have open never shows. Needs Xcode's command-line tools (swiftc), Screen Recording permission
// for your terminal, and permission to control System Events (macOS asks once; used to put Finder's menu bar up).
// Elsewhere the window alone is captured and there is no GIF.
const { _electron: electron } = require('playwright-core');
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const DOCS = path.join(__dirname, '..', 'docs');
const MAC = process.platform === 'darwin';
const D = 864e5, H = 36e5, M = 6e4;
const now = Date.now();
const p2 = (n) => String(n).padStart(2, '0');
const day = (t) => { const d = new Date(t); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const at = (t, hh, mm = 0) => `${day(t)}T${p2(hh)}:${p2(mm)}`;
const nextWeekday = (wd) => { const d = new Date(now); do d.setDate(d.getDate() + 1); while (d.getDay() !== wd); return d.getTime(); };
const has = (cmd) => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };

// a bar chart as a PNG, standing in for a pasted screenshot (no image libraries needed)
function chartPng(w = 420, h = 200) {
  const px = Buffer.alloc(w * h * 4, 255);
  const set = (x, y, [r, g, b]) => { const i = (y * w + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, [250, 250, 252]);
  for (const gy of [50, 95, 140]) for (let x = 18; x < w - 18; x += 2) set(x, gy, [222, 226, 232]); // grid lines
  const bars = [46, 58, 52, 71, 83, 77, 128];
  bars.forEach((v, k) => {
    const x0 = 30 + k * 54;
    for (let x = x0; x < x0 + 36; x++) for (let y = h - 24 - v; y < h - 24; y++) set(x, y, k === bars.length - 1 ? [26, 111, 214] : [148, 180, 228]);
  });
  for (let x = 18; x < w - 18; x++) set(x, h - 24, [96, 100, 108]); // axis
  const raw = Buffer.concat(Array.from({ length: h }, (_, y) => Buffer.concat([Buffer.from([0]), px.subarray(y * w * 4, (y + 1) * w * 4)])));
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type), body]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(tb));
    return Buffer.concat([len, tb, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- sample data: four tabs, five labels, every kind of note ----
const labels = [
  { id: 'act', name: 'Action', color: 0 }, { id: 'q', name: 'Question', color: 4 }, { id: 'dec', name: 'Decision', color: 3 },
  { id: 'blk', name: 'Blocker', color: 1 }, { id: 'idea', name: 'Idea', color: 5 },
];
const tabs = [
  { id: 'sync', name: 'Product sync', layout: 'row', columns: [{ id: 'todo', name: 'To do' }] },
  { id: 'sprint', name: 'Sprint board', layout: 'board', columns: [
    { id: 'backlog', name: 'Backlog', color: 4, limit: 3 }, { id: 'doing', name: 'In progress', color: 1, limit: 2 },
    { id: 'review', name: 'Review', color: 5 }, { id: 'done', name: 'Done', done: true, color: 3 }] },
  { id: 'me', name: 'Personal', layout: 'row', columns: [{ id: 'todo', name: 'To do' }] },
  { id: 'one', name: '1:1 Priya', layout: 'row', columns: [{ id: 'todo', name: 'To do' }] },
];
const note = (id, tab, color, text, extra = {}) => ({ id, tab, color, text, created: now - 2 * D, updated: now - 2 * H, ...extra });
const notes = [
  // Product sync (the hero)
  note('s1', 'sync', 0, '# Product sync\n**With:** Sam, Priya, Lee\n\n- [x] Launch recap\n- [x] Hiring plan\n- [ ] Budget for Q1\n- [ ] Pricing page copy',
    { labels: ['act'], due: at(now, 17, 30), updated: now - 25 * M }),
  note('s2', 'sync', 2, '## Signups this week\n![signups](attachment:signups.png)\nUp **18%** since the launch post', { labels: ['dec'], updated: now - 40 * M }),
  note('s3', 'sync', 1, '## Decisions\n1. Ship v2 on **Friday**\n2. Cut the beta scope\n3. Pricing stays as is\n\n> "Keep it simple" - Lee',
    { labels: ['dec'], due: at(nextWeekday(1), 9), repeat: 'weekly' }),
  note('s4', 'sync', 3, '## Open questions\n- Who owns the **status page**?\n- Do we need `SSO` for v2?\n\nhttps://example.com/rfc-42',
    { labels: ['q', 'blk'], due: at(now - D, 12) }),
  note('s5', 'sync', 4, '## Someday\nDark-mode logo, a nicer 404 page', { labels: ['idea'], created: now - 40 * D, updated: now - 12 * D }),
  note('s6', 'sync', 2, 'Old agenda', { archived: now - 3 * D }),
  note('s7', 'sync', 1, 'Draft invite list', { archived: now - D }),
  // Sprint board
  note('b1', 'sprint', 4, '## Dark mode for the dashboard', { col: 'backlog', labels: ['idea'] }),
  note('b2', 'sprint', 2, 'Write the release notes', { col: 'backlog', due: at(now + 2 * D, 12) }),
  note('b3', 'sprint', 0, '## Rate-limit the public API\nneeds a decision on limits', { col: 'backlog', labels: ['q'] }),
  note('b4', 'sprint', 3, 'Update the docs site', { col: 'backlog' }),
  note('b5', 'sprint', 1, '## Fix login timeout\n- [x] Reproduce\n- [x] Root cause\n- [ ] Patch\n- [ ] Regression test',
    { col: 'doing', labels: ['blk'], due: at(now, 15) }),
  note('b6', 'sprint', 4, '## New onboarding flow\n- [x] Design\n- [x] Build\n- [ ] Usability test', { col: 'doing', labels: ['act'], due: at(now + D, 12) }),
  note('b7', 'sprint', 2, '## Search speed-up\nPR #482, waiting on review', { col: 'review', labels: ['act'] }),
  note('b8', 'sprint', 3, 'Ship v2', { col: 'done', done: true, labels: ['dec'] }),
  note('b9', 'sprint', 0, 'Billing emails', { col: 'done', done: true }),
  // Personal
  note('m1', 'me', 3, '## Groceries\n- [ ] coffee beans\n- [x] oat milk\n- [ ] sourdough\n- [x] lemons', { due: at(nextWeekday(6), 10), repeat: 'weekly' }),
  note('m2', 'me', 1, '## Book the dentist', { due: at(now - 2 * D, 9), labels: ['act'] }),
  note('m3', 'me', 2, '## Gift ideas for Sam\n- record player\n- that ramen cookbook', { labels: ['idea'], updated: now - 6 * D }),
  note('m4', 'me', 0, '## Holiday plans\nLisbon in March?\nlook at flights', { created: now - 30 * D, updated: now - 20 * D }),
  note('m5', 'me', 4, 'Renew passport', { done: true }),
  // 1:1
  note('o1', 'one', 0, '## 1:1 with Priya\n- [ ] Career goals\n- [ ] Feedback on the launch', { due: at(nextWeekday(4), 14), repeat: 'weekly' }),
];

// the capture helper, compiled once per run
let captureBin;
function captureTool() {
  if (!captureBin) {
    captureBin = path.join(os.tmpdir(), `sd-capture-${process.pid}`);
    execFileSync('swiftc', ['-O', '-parse-as-library', path.join(__dirname, 'capture.swift'), '-o', captureBin]);
  }
  return captureBin;
}
// the menu bar shows the frontmost app's menus: make that Finder's (it has no windows in the shot either way)
const finderFront = () => { try { execFileSync('osascript', ['-e', 'tell application "System Events" to set frontmost of process "Finder" to true']); } catch { /* menu bar shows another app */ } };
function capture(page, name) {
  const file = path.join(DOCS, name + '.jpg');
  if (!MAC) return page.screenshot({ path: file, type: 'jpeg', quality: 85, scale: 'css' });
  finderFront();
  const png = path.join(os.tmpdir(), `sd-shot-${Date.now()}.png`);
  execFileSync(captureTool(), ['still', png]);
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '--resampleWidth', '1920', png, '--out', file], { stdio: 'ignore' });
  fs.rmSync(png);
}

async function launch(settings, data = {}, show = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-shots-'));
  fs.mkdirSync(path.join(dir, 'attachments'));
  fs.writeFileSync(path.join(dir, 'attachments', 'signups.png'), chartPng());
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ version: 3, settings: { heightPct: 50, ...settings }, tabs,
    activeTab: 'sync', labels, notes, ...data }));
  const env = { ...process.env, STICKYDROP_DATA: dir, STICKYDROP_NO_NOTIFY: '1' };
  if (show) env.STICKYDROP_SHOW = '1';
  const app = await electron.launch({ args: [path.join(__dirname, '..'), '--no-sandbox'], env });
  const page = await app.firstWindow();
  await page.waitForSelector('.note', { state: 'attached' });
  await page.evaluate(() => api.setPinned(true)); // a shot must not vanish if focus moves
  return { app, page };
}

async function shoot(name, settings, act, data) {
  const { app, page } = await launch(settings, data);
  await page.waitForTimeout(500);
  await page.evaluate(() => { // notes render as Markdown unless being edited; columns start at the top
    document.activeElement.blur();
    document.querySelectorAll('.col').forEach((c) => { c.scrollTop = 0; });
  });
  if (act) await act(page);
  await page.waitForTimeout(800); // slide-in finished, images decoded
  await capture(page, name);
  await app.close();
}

// docs/drop.gif: the desktop, then the notes drop in from the top, stay a moment, and hide (macOS + ffmpeg)
async function recordDrop(settings) {
  if (!MAC || !has('ffmpeg')) return console.log('skipping drop.gif (needs macOS and ffmpeg)');
  captureTool(); // compile before timing anything
  const { app, page } = await launch(settings, {}, false);
  const toggle = () => app.evaluate(({ app: a }) => a.emit('second-instance', {}, ['--toggle'])); // what `stickydrop --toggle` does
  await toggle(); // a first show and hide warms everything up, so the recorded drop is smooth
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.activeElement.blur());
  await toggle();
  // the window drops in ready to type in the last-focused note (shown as raw Markdown): make that the short one
  await page.evaluate(() => { lastFocus = notes.findIndex((n) => n.id === 's5'); });
  await page.waitForTimeout(800);
  finderFront();
  const mov = path.join(os.tmpdir(), `sd-drop-${Date.now()}.mov`);
  const rec = spawn(captureTool(), ['video', '3.9', mov]);
  await new Promise((r) => rec.stdout.on('data', (d) => { if (String(d).includes('recording')) r(); })); // frames are being written
  await page.waitForTimeout(1100);
  await toggle(); // drop in
  await page.waitForTimeout(2200);
  await toggle(); // and away
  await new Promise((r) => rec.on('exit', r));
  await app.close();
  // the top two thirds of the screen (the window plus some desktop), 1200px wide, 25 fps, one shared palette;
  // ordered (bayer) dithering keeps the wallpaper's gradients small, and only changed areas are stored per frame
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.3', '-i', mov, '-vf',
    'fps=25,crop=iw:ih*0.66:0:0,scale=1200:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:max_colors=160[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
    '-loop', '0', path.join(DOCS, 'drop.gif')]);
  fs.rmSync(mov);
}

(async () => {
  fs.mkdirSync(DOCS, { recursive: true });
  const dark = { theme: 'dark' };
  if (process.argv[2] === 'gif') { await recordDrop(dark); if (captureBin) fs.rmSync(captureBin, { force: true }); return; }
  for (const f of fs.readdirSync(DOCS)) if (/\.(png|jpg|gif)$/.test(f)) fs.rmSync(path.join(DOCS, f)); // regenerated whole
  await recordDrop(dark);
  await shoot('hero', dark);
  await shoot('board', { ...dark, heightPct: 58 }, null, { activeTab: 'sprint' });
  await shoot('light', { theme: 'light', palette: 'pastel', aging: 'vintage', font: 'sans' }, null, { activeTab: 'me' });
  await shoot('find', dark, async (page) => {
    await page.keyboard.press('Control+f');
    await page.locator('#quick .chip', { hasText: 'Decision' }).click();
  });
  await shoot('due', dark, (page) => page.locator('.note').nth(2).locator('.due').click());
  await shoot('settings', { ...dark, heightPct: 80 }, (page) => page.evaluate(async () => { await openSettings(); showSettingsTab('Appearance', true); }));
  console.log('wrote docs/*.jpg' + (MAC ? ' and docs/drop.gif' : ''));
  if (captureBin) fs.rmSync(captureBin, { force: true });
})().catch((e) => { console.error(e); process.exit(1); });
