// Drives the real app with an isolated data dir. Run: npm test
const { _electron: electron } = require('playwright-core');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stickydrop-test-'));
const dataFile = path.join(dir, 'data.json');
const readData = () => JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const Time_checklist = (t) => { const c = require('../timeutil').checklist(t); return `${c.done}/${c.total}`; };
const launch = () => electron.launch({
  args: [path.join(__dirname, '..'), '--no-sandbox'],
  env: { ...process.env, STICKYDROP_DATA: dir, STICKYDROP_SHOW: '1', STICKYDROP_NO_NOTIFY: '1' },
});
const visible = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());

(async () => {
  let app = await launch();
  let page = await app.firstWindow();
  await page.waitForSelector('textarea');

  // starts with one empty note, drops down visible at top of work area
  assert.equal(await page.locator('.note').count(), 1);
  assert(await visible(app), 'window visible after show');
  const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  console.log('bounds', b);

  // type + add notes + persistence
  await page.locator('textarea').first().fill('standup: ship it');
  await page.keyboard.press('Control+n');
  await page.keyboard.type('second note');
  assert.equal(await page.locator('.note').count(), 2);
  await page.waitForTimeout(500);
  assert.deepEqual(readData().notes.map((n) => n.text), ['standup: ship it', 'second note']);

  // delete + undo
  await page.locator('.note-head button[title="Archive note"]').nth(1).click();
  assert.equal(await page.locator('.note').count(), 1);
  await page.click('#undo');
  assert.equal(await page.locator('.note').count(), 2);

  // colour cycle
  const bg = () => page.locator('.note').first().evaluate((e) => e.style.getPropertyValue('--note-bg'));
  const before = await bg();
  await page.locator('.note-head button[title="Change colour"]').first().click();
  assert.notEqual(await bg(), before);

  // markdown: rendered when not editing, click/focus to edit, tasks toggle, links open externally, no HTML injection
  await app.evaluate(({ shell }) => { globalThis.__opened = []; shell.openExternal = (u) => { __opened.push(u); return Promise.resolve(); }; });
  await page.keyboard.press('Control+n');
  const md = ['# Title', 'some **bold**, *it*, ~~gone~~ and `code`', '', '- [ ] todo one', '- [x] done two', '- plain', '  - nested', '1. first', '', '> quoted', '', '[site](https://example.com/a) and https://example.org/b.', '<img src=x onerror="document.title=1"> <b>raw</b>', '```', '**not bold**', '```'].join('\n');
  await page.locator('.note').nth(2).locator('textarea').fill(md);
  await page.locator('.note').first().locator('.view').click(); // moves focus: note 3 renders, note 1 edits
  const v3 = page.locator('.note').nth(2).locator('.view');
  assert(await v3.isVisible() && !(await page.locator('.note').nth(2).locator('textarea').isVisible()), 'rendered when not editing');
  assert.equal(await v3.locator('h1').textContent(), 'Title');
  assert.equal(await v3.locator('strong').first().textContent(), 'bold');
  assert.equal(await v3.locator('em').textContent(), 'it');
  assert.equal(await v3.locator('del').textContent(), 'gone');
  assert.equal(await v3.locator('p code').first().textContent(), 'code');
  assert.equal(await v3.locator('li.task').count(), 2);
  assert.equal(await v3.locator('li.done input').isChecked(), true);
  assert.equal(await v3.locator('li ul li').textContent(), 'nested', 'nested list');
  assert.equal(await v3.locator('ol li').textContent(), 'first');
  assert.equal(await v3.locator('blockquote').textContent(), 'quoted');
  assert.equal(await v3.locator('pre code').textContent(), '**not bold**', 'fenced code is literal');
  assert.equal(await v3.locator('img, script').count(), 0, 'raw HTML is not rendered');
  assert((await v3.textContent()).includes('<img src=x onerror='), 'raw HTML shown as text');
  assert.equal(await page.evaluate(() => document.title), 'StickyDrop');
  // task checkbox flips the source without entering edit mode
  await v3.locator('li.task input').first().click();
  assert.match(await page.locator('.note').nth(2).locator('textarea').inputValue(), /- \[x\] todo one/);
  assert(await v3.isVisible(), 'still rendered after checkbox');
  // links go to the real browser, the window doesn't navigate
  await v3.locator('a', { hasText: 'site' }).click();
  await page.waitForTimeout(300);
  assert.deepEqual(await app.evaluate(() => globalThis.__opened), ['https://example.com/a']);
  assert.equal(await v3.locator('a').nth(1).getAttribute('href'), 'https://example.org/b', 'bare url, trailing dot excluded');
  assert(await v3.isVisible(), 'clicking a link does not start editing');
  // click on rendered text edits it, caret in the textarea
  await v3.click({ position: { x: 5, y: 5 } });
  assert(await page.locator('.note').nth(2).locator('textarea').isVisible());
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'TEXTAREA');
  // toggle the setting off: always plain text
  await page.evaluate(() => apply({ markdown: false }));
  assert.equal(await page.locator('.note .view:visible').count(), 0, 'markdown off shows textareas only');
  await page.evaluate(() => apply({ markdown: true }));
  await page.waitForTimeout(100);
  // remove the scratch note again
  await page.locator('.note-head button[title="Archive note"]').nth(2).click();
  assert.equal(await page.locator('.note').count(), 2);

  // due dates, done, timestamps, aging
  const note1 = page.locator('.note').first();
  const cls = (loc, c) => loc.evaluate((e, c) => e.classList.contains(c), c);
  await note1.hover();
  await note1.locator('.due').click();
  try { // a native date popup must not blur-hide the window
    await page.evaluate(() => document.querySelector('.due-pop input[type=date]').showPicker());
    await page.waitForTimeout(700);
    assert(await visible(app), 'window survives the native date picker popup');
    console.log('native picker popup: window stayed visible');
  } catch (e) { if (e.name === 'AssertionError') throw e; console.log('native picker not testable:', e.message.split('\n')[0]); }
  await page.locator('.due-pop').getByRole('button', { name: 'Today' }).click();
  assert.equal(await note1.locator('.due').textContent(), 'Today');
  assert(await cls(note1.locator('.due'), 'today'));
  await page.locator('.due-pop input[type=date]').fill('2020-01-01');
  await page.locator('.due-pop input[type=time]').fill('09:30');
  assert.equal(await note1.locator('.due').textContent(), '⚠ 1 Jan 2020 09:30');
  assert(await cls(note1, 'overdue') && await cls(note1.locator('.due'), 'overdue'), 'overdue is flagged');
  await page.waitForTimeout(450);
  assert.equal(readData().notes[0].due, '2020-01-01T09:30', 'due persisted');
  await note1.locator('button[title="Mark done"]').click(); // also closes the popover (click outside)
  assert(await cls(note1, 'done') && !(await cls(note1, 'overdue')) && await cls(note1.locator('.due'), 'quiet'), 'done notes are not overdue');
  await note1.locator('button[title="Mark not done"]').click();
  assert(await cls(note1, 'overdue'));
  await note1.locator('.due').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.due-pop').count(), 0, 'Esc closes the popover');
  assert(await visible(app), 'Esc in the popover does not hide the window');
  await note1.locator('.due').click();
  await page.locator('.due-pop').getByRole('button', { name: 'Clear' }).click();
  assert.equal(await note1.locator('.due').textContent(), '+ Due');
  assert.equal(await cls(note1, 'overdue'), false);
  await page.keyboard.press('Escape'); // close the popover: in a short window it covers the note clicked below

  // aging is measured from the last edit; overdue stays a separate signal
  const look = () => note1.evaluate((e) => ({ age: e.style.getPropertyValue('--age'), op: getComputedStyle(e, '::before').opacity,
    filter: getComputedStyle(e, '::before').filter, curl: getComputedStyle(e, '::after').width }));
  await page.evaluate(() => { notes[0].updated = Date.now() - 20 * 864e5; refreshAll(); });
  let l = await look();
  assert.equal(l.age, '1.000'); assert(Math.abs(l.op - 0.55) < 0.01, 'fade at full age: ' + l.op);
  assert.match(await note1.locator('.foot').textContent(), /edited 2w ago/);
  await page.evaluate(() => apply({ aging: 'vintage' }));
  l = await look();
  assert(l.filter.includes('sepia') && l.curl === '34px', 'vintage: ' + JSON.stringify(l));
  await page.evaluate(() => apply({ aging: 'off' }));
  l = await look();
  assert.equal(Number(l.age), 0); assert.equal(l.op, '1');
  await page.evaluate(() => apply({ aging: 'fade', agingDays: 40 }));
  assert((await look()).age === '0.500', 'agingDays rescales');
  await page.evaluate(() => apply({ agingDays: 14 }));
  await note1.locator('.view').click(); // editing rejuvenates
  await page.keyboard.type('x'); await page.keyboard.press('Backspace');
  l = await look();
  assert.equal(Number(l.age), 0, 'edit resets age');
  assert.match(await note1.locator('.foot').textContent(), /edited just now/);
  await page.evaluate(() => apply({ showAge: false }));
  assert.equal(await note1.locator('.foot').isVisible(), false);
  await page.evaluate(() => apply({ showAge: true }));

  // done + "move to end": the finished note parks at the end
  await page.keyboard.press('Control+n');
  await page.keyboard.type('scratch');
  await page.evaluate(() => apply({ doneSink: true }));
  await note1.locator('button[title="Mark done"]').click();
  assert.deepEqual(await page.evaluate(() => notes.filter((n) => !n.archived).map((n) => n.text)), ['second note', 'scratch', 'standup: ship it']);
  await page.evaluate(() => { notes.unshift(notes.pop()); notes[0].done = false; save(); render(); apply({ doneSink: false }); });
  await page.locator('.note-head button[title="Archive note"]').nth(2).click();
  assert.deepEqual(await page.evaluate(() => notes.filter((n) => !n.archived).map((n) => n.text)), ['standup: ship it', 'second note']);

  // settings: height + hotkey change + invalid hotkey is rejected
  await page.keyboard.press('Control+,');
  await page.getByRole('tab', { name: 'Window' }).click();
  await page.locator('#s-heightPct').fill('60');
  await page.getByRole('tab', { name: 'General' }).click();
  await page.locator('#hotkey').click();
  await page.keyboard.press('Control+Alt+KeyJ');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#hotkey').textContent(), 'Control+Alt+J');
  const r = await page.evaluate(() => api.setSettings({ hotkey: 'Bogus+++' }));
  assert.equal(r.ok, false);
  await page.waitForTimeout(500);
  assert.equal(readData().settings.hotkey, 'Control+Alt+J');
  assert.equal(readData().settings.heightPct, 60);

  // window geometry settings move the visible window
  const geo = () => app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0]; const b = w.getBounds();
    return { b, a: screen.getDisplayMatching(b).workArea };
  });
  const set = (patch) => page.evaluate((p) => apply(p), patch); // renderer-side apply: also restyles
  await set({ valign: 'bottom', widthPct: 50, halign: 'right', heightPct: 30 });
  let { b: gb, a } = await geo();
  assert.equal(gb.y + gb.height, a.y + a.height, 'bottom aligned');
  assert.equal(gb.x + gb.width, a.x + a.width, 'right aligned');
  assert(Math.abs(gb.width - a.width / 2) <= 1 && Math.abs(gb.height - a.height * 0.3) <= 1, 'sized');
  await set({ valign: 'top', widthPct: 100, halign: 'center', heightPct: 60 });
  ({ b: gb, a } = await geo());
  assert.equal(gb.y, a.y); assert.equal(gb.width, a.width);

  // appearance: opacity, palette, font, toolbar, theme; bad values rejected/clamped
  await set({ opacity: 50, fontSize: 24, font: 'mono', showToolbar: false, theme: 'light', palette: 'mono' });
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--pct')), '50%');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('textarea')).fontSize), '24px');
  assert.equal(await page.evaluate(() => document.getElementById('toolbar').hidden), true);
  assert((await bg()).includes('#eeeeee'), 'mono palette, 2nd colour');
  assert.equal(await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors), false, 'light theme');
  const chrome = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--chrome').trim());
  assert.equal(await chrome(), '#f6f6f6', 'explicit light theme');
  await set({ theme: 'dark' });
  assert.equal(await chrome(), '#2a2a2a', 'explicit dark theme, independent of the OS');
  await set({ theme: 'system' });
  const osLight = await page.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches);
  assert.equal(await chrome(), osLight ? '#f6f6f6' : '#2a2a2a', 'system theme follows the OS');
  await set({ theme: 'light' });
  await set({ fontSize: 999, palette: 'nope', widthPct: 'x', valign: 'sideways' });
  const st = (await set({})).settings;
  assert.equal(st.fontSize, 32); assert.equal(st.palette, 'mono'); assert.equal(st.widthPct, 100); assert.equal(st.valign, 'top');
  await set({ opacity: 100, fontSize: 14, font: 'hand', showToolbar: true, theme: 'dark', palette: 'classic' });
  assert.equal(await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors), true);
  await page.waitForTimeout(500);
  assert.equal(readData().settings.heightPct, 60);

  // the settings form is generated from the schema: a tab per group, one panel showing, every control present
  await page.keyboard.press('Control+,');
  await page.waitForSelector('#s-palette', { state: 'attached' });
  assert.deepEqual(await page.getByRole('tab').allTextContents(), ['General', 'Window', 'Appearance', 'Notes', 'Reminders', 'Labels', 'Data']);
  assert.equal(await page.locator('.settings-panel:visible').count(), 1, 'one settings tab at a time');
  assert(await page.locator('#settings-body [id^="s-"]:not(output)').count() >= 26);
  assert.equal(await page.locator('#s-display option').count() >= 2, true);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'General', 'the tab list has focus');
  await page.keyboard.press('ArrowDown'); // arrow keys move between tabs
  await page.keyboard.press('ArrowDown');
  assert(await page.locator('#s-palette').isVisible(), 'Appearance showing');
  assert.equal(await page.locator('.settings-panel:visible .settings-section h3').first().textContent(), 'Window');
  await page.locator('#s-showToolbar').click(); // a switch toggles its setting
  assert.equal(await page.evaluate(() => settings.showToolbar), false);
  await page.locator('#s-showToolbar').click();
  assert.equal(await page.evaluate(() => settings.showToolbar), true);
  await page.getByRole('tab', { name: 'Labels' }).click();
  await page.locator('#labels-set input[aria-label="New label"]').fill('Decision');
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => labels.map((l) => l.name)), ['Decision'], 'a label can be added in Settings');
  await page.locator('#labels-set button[title^="Delete label"]').click();
  assert.deepEqual(await page.evaluate(() => labels.length), 0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+,');
  assert(await page.locator('#labels-set').isVisible(), 'reopening shows the last settings tab');
  await page.getByRole('tab', { name: 'General' }).click();
  assert(await page.locator('#s-autoUpdate').isChecked(), 'update checks are on by default');
  await page.getByRole('button', { name: 'Check now' }).click();
  await page.waitForFunction(() => document.querySelector('#settings-body').textContent.includes('installed builds'));
  assert.deepEqual(await page.evaluate(() => api.checkUpdates()), { status: 'unsupported' }, 'running from source never checks');

  // settings stay usable in a short window: buttons visible, body scrolls if needed
  await set({ heightPct: 15 });
  await page.waitForTimeout(300);
  const fit = await page.evaluate(() => {
    const f = document.getElementById('settings-form').getBoundingClientRect();
    const d = document.getElementById('settings-close').getBoundingClientRect();
    const q = document.getElementById('quit').getBoundingClientRect();
    const b = document.getElementById('settings-body');
    return { formBottom: f.bottom, vh: innerHeight, doneBottom: d.bottom, quitBottom: q.bottom, scrolls: b.scrollHeight > b.clientHeight };
  });
  assert(fit.formBottom <= fit.vh && fit.doneBottom <= fit.vh && fit.quitBottom <= fit.vh, 'form, Done and Quit fit in the window');
  assert(fit.scrolls, 'body scrolls at 15% height');
  await set({ heightPct: 60 });

  // Esc closes settings first, then hides the window
  await page.keyboard.press('Escape');
  assert(await visible(app), 'first Esc only closes settings');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert(!(await visible(app)), 'second Esc hides');

  // `--toggle` from a second process (what a system shortcut runs) shows/hides the running window
  const toggle = () => require('child_process').spawnSync(
    require('electron'), [path.join(__dirname, '..'), '--no-sandbox', '--toggle'],
    { env: { ...process.env, STICKYDROP_DATA: dir } });
  toggle(); await page.waitForTimeout(500);
  assert(await visible(app), '--toggle shows');
  toggle(); await page.waitForTimeout(500);
  assert(!(await visible(app)), '--toggle hides');

  // pinned + unfocused: first toggle refocuses (stays visible), second hides
  const focused = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused());
  toggle(); await page.waitForTimeout(500);
  await page.evaluate(() => api.setPinned(true));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].blur());
  await page.waitForTimeout(400);
  assert(await visible(app) && !(await focused()), 'pinned window survives blur');
  toggle(); await page.waitForTimeout(500);
  assert(await visible(app) && await focused(), 'toggle refocuses unfocused window');
  toggle(); await page.waitForTimeout(500);
  assert(!(await visible(app)), 'toggle hides focused window');
  await page.evaluate(() => api.setPinned(false));

  // restart: notes + settings survive
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.waitForSelector('textarea');
  assert.deepEqual(await page.locator('textarea').evaluateAll((t) => t.map((x) => x.value)), ['standup: ship it', 'second note']);
  assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Alt+J')), true);
  // reset to defaults: two-click confirm, settings restored (incl. hotkey), notes kept
  await page.evaluate(() => apply({ opacity: 60, palette: 'earth', halign: 'left', fontSize: 28, theme: 'light' }));
  await page.keyboard.press('Control+,');
  await page.waitForSelector('#reset');
  await page.waitForTimeout(500); // let the debounced save land
  await page.click('#reset');
  assert.equal(await page.locator('#reset').textContent(), 'Click again to confirm');
  assert.equal(readData().settings.opacity, 60, 'first click changes nothing');
  await page.click('#reset');
  await page.waitForTimeout(600);
  const d = readData();
  const defaults = await page.evaluate(() => Object.fromEntries(Object.entries(meta.schema).map(([k, s]) => [k, s.def])));
  for (const [k, v] of Object.entries(defaults)) if (k !== 'display') assert.deepEqual(d.settings[k], v, 'reset ' + k);
  const defKey = process.platform === 'darwin' ? 'Control+Alt+N' : 'F9';
  if (d.settings.hotkey === defKey) {
    assert.equal(await app.evaluate(({ globalShortcut }, k) => globalShortcut.isRegistered(k), defKey), true);
    assert.equal(await page.locator('#hotkey').textContent(), defKey);
  } else { // the default key held by another running StickyDrop: everything else reset and the user is told why
    assert.match(await page.locator('#settings-err').textContent(), /taken/);
  }
  assert.equal(await page.locator('#s-opacity').inputValue(), '85', 'default opacity');
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--pct')), '85%');
  assert.deepEqual(d.notes.filter((n) => !n.archived).map((n) => n.text), ['standup: ship it', 'second note'], 'notes kept');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(dir, 'shot.png') });
  console.log('screenshot', path.join(dir, 'shot.png'));
  await app.close();

  // upgrading from before version 2: old default theme/opacity move to the new defaults once; a chosen value stays
  fs.writeFileSync(dataFile, JSON.stringify({ settings: { theme: 'dark', opacity: 100, fontSize: 17, palette: 'earth' }, notes: [{ id: 'x', text: 'hi', color: 0 }] }));
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('textarea');
  assert.deepEqual(await page.evaluate(() => [settings.theme, settings.opacity, settings.fontSize, settings.palette]), ['system', 85, 14, 'earth'], 'moved to the new defaults');
  await page.evaluate(() => apply({ theme: 'dark', opacity: 100, fontSize: 17 })); // chosen after the upgrade: kept from now on
  await page.waitForTimeout(500);
  await app.close();
  assert.equal(readData().version, 3);
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('textarea');
  assert.deepEqual(await page.evaluate(() => [settings.theme, settings.opacity, settings.fontSize]), ['dark', 100, 17], 'the migration runs only once');
  await app.close();
  // a version-2 file (alpha.3 betas) only gets the font-size step
  fs.writeFileSync(dataFile, JSON.stringify({ version: 2, settings: { theme: 'dark', opacity: 100, fontSize: 17 }, notes: [{ id: 'x', text: 'hi', color: 0 }] }));
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('textarea');
  assert.deepEqual(await page.evaluate(() => [settings.theme, settings.opacity, settings.fontSize]), ['dark', 100, 14], 'each step runs once');
  await app.close();

  // corrupt file is moved aside, not overwritten
  fs.writeFileSync(dataFile, '{not json');
  app = await launch();
  page = await app.firstWindow();
  await page.waitForSelector('textarea');
  assert(fs.readdirSync(dir).some((f) => f.includes('corrupt')), 'corrupt file preserved');
  await app.close();

  // ---- kanban board ----
  app = await launch();
  page = await app.firstWindow();
  await page.waitForSelector('textarea');
  const setLayout = (v) => page.evaluate((l) => apply({ layout: l }), v);
  const colNames = () => page.locator('.col .col-name').allTextContents();
  const inCol = (i) => page.locator('.col').nth(i).locator('textarea').evaluateAll((t) => t.map((x) => x.value));
  await page.locator('textarea').first().fill('A');
  await page.keyboard.press('Control+n'); await page.keyboard.type('B');
  await page.keyboard.press('Control+n'); await page.keyboard.type('C');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.col').count(), 0, 'row layout has no columns');
  await setLayout('board');
  assert.deepEqual(await colNames(), ['To do', 'Doing', 'Done']);
  assert.deepEqual(await inCol(0), ['A', 'B', 'C'], 'notes without a column start in the first');

  // drag B (second) to Doing, then C (now second) into Done (marks it done)
  await page.locator('.col').nth(0).locator('.note').nth(1).locator('.note-head').dragTo(page.locator('.col').nth(1));
  assert.deepEqual(await inCol(1), ['B']);
  await page.locator('.col').nth(0).locator('.note').nth(1).locator('.note-head').dragTo(page.locator('.col').nth(2));
  assert.deepEqual(await inCol(2), ['C']);
  assert(await page.locator('.col').nth(2).locator('.note.done').count() === 1, 'dropping into Done marks it done');

  // keyboard: Alt+Left moves C back out of Done (clears done); Alt+Up reorders
  await page.locator('.col').nth(2).locator('.note-head').click();
  await page.locator('.col').nth(2).locator('.view, textarea').first().click();
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForTimeout(100);
  assert.deepEqual(await inCol(1), ['B', 'C'], 'Alt+Left moves to the previous column');
  assert.equal(await page.locator('.note.done').count(), 0, 'leaving Done clears done');
  await page.keyboard.press('Alt+ArrowUp');
  assert.deepEqual(await inCol(1), ['C', 'B'], 'Alt+Up reorders within the column');

  // ✓ in board mode moves to Done
  await page.locator('.col').nth(1).locator('.note').first().locator('button[title="Mark done"]').click();
  assert.deepEqual(await inCol(2), ['C']);

  // rename, add, delete columns
  await page.locator('.col-name').first().click();
  await page.keyboard.type('Backlog'); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#toolbar #addcol:visible').count(), 1, '+ Column sits in the toolbar on a board');
  assert.equal(await page.locator('#board > button').count(), 0, 'and takes no board width');
  await page.getByRole('button', { name: '+ Column' }).click();
  await page.keyboard.type('Review'); await page.keyboard.press('Enter');
  assert.deepEqual(await colNames(), ['Backlog', 'Doing', 'Done', 'Review']);
  await page.waitForTimeout(500);
  assert.deepEqual(readData().tabs[0].columns.map((c) => c.name), ['Backlog', 'Doing', 'Done', 'Review']);
  await page.locator('.col').nth(1).locator('.col-menu-btn').click();
  await page.getByRole('button', { name: 'Delete column' }).click();
  assert.deepEqual(await colNames(), ['Backlog', 'Done', 'Review']);
  assert.deepEqual(await inCol(0), ['A', 'B'], 'deleted column notes go to the first column');

  // column colour, soft note limit, collapse, reorder by dragging the header
  const menu = (i) => page.locator('.col').nth(i).locator('.col-menu-btn').click();
  await menu(1);
  await page.locator('.col-menu .swatch').nth(4).click();
  assert(await page.locator('.col').nth(1).evaluate((x) => x.classList.contains('colored') && x.style.getPropertyValue('--col-accent') !== ''), 'colour applies');
  await menu(0);
  await page.locator('.col-menu input[type=number]').fill('1');
  await page.keyboard.press('Tab'); // the change event re-renders and closes the menu
  assert(await page.locator('.col').nth(0).evaluate((x) => x.classList.contains('over-limit')), '2 notes over a limit of 1 warns');
  assert.equal(await page.locator('.col').nth(0).locator('.count').textContent(), '2/1');
  assert.equal(await page.locator('.col').nth(0).locator('.note').count(), 2, 'limit never blocks');
  await page.locator('.col').nth(1).locator('.fold').click();
  assert(await page.locator('.col').nth(1).evaluate((x) => x.classList.contains('collapsed') && x.querySelector('.note').offsetParent === null), 'collapsed hides notes');
  const review = page.locator('.col').nth(2);
  const box = await review.boundingBox();
  await page.locator('.col').nth(1).locator('.col-head').dragTo(review, { targetPosition: { x: box.width - 5, y: 100 } });
  assert.deepEqual(await colNames(), ['Backlog', 'Review', 'Done'], 'columns reordered by dragging');
  await page.waitForTimeout(500);
  const saved = readData().tabs[0].columns;
  assert.deepEqual(saved.map((c) => c.name), ['Backlog', 'Review', 'Done']);
  assert.equal(saved[2].collapsed, true);
  assert.equal(saved[2].color, 3); // swatch 0 is "no colour"
  assert.equal(saved[0].limit, 1);

  // a slow, real-mouse-style drag: a drop marker follows, Esc cancels without hiding the window; releasing elsewhere moves the note
  const hb = await page.locator('.col').nth(0).locator('.note').first().locator('.note-head').boundingBox();
  const tb = await page.locator('.col').nth(1).boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + 8);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 40, hb.y + 40, { steps: 5 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + 120, { steps: 10 });
  assert.equal(await page.locator('.col').nth(1).and(page.locator('.drop-end')).count(), 1, 'the target column shows where the note will land');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal(await page.locator('.drop-end, .drop-before').count(), 0, 'Esc clears the drop marker');
  assert(await visible(app), 'Esc cancels the drag without hiding the window');
  assert.deepEqual(await inCol(0), ['A', 'B'], 'a cancelled drag moves nothing');
  await page.mouse.move(hb.x + hb.width / 2, hb.y + 8);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + 120, { steps: 10 });
  await page.mouse.up();
  assert.deepEqual(await inCol(0), ['B'], 'a stepwise drag moves the note out');
  assert.deepEqual(await inCol(1), ['A'], 'and into the column it was released over');

  // persists across restart; switching to Row keeps every note; reset keeps columns and notes
  await page.waitForTimeout(500);
  await app.close();
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('.col');
  assert.deepEqual(await colNames(), ['Backlog', 'Review', 'Done']);
  await setLayout('row');
  assert.deepEqual(await page.locator('textarea').evaluateAll((t) => t.map((x) => x.value)).then((v) => v.sort()), ['A', 'B', 'C']);

  assert(await page.locator('#addcol').isHidden(), 'no + Column in the row layout');
  // row layout: the header's empty space is a handle (grab cursor, grip), dragging reorders, Alt+arrows too
  const rowOrder = () => page.locator('#board > .note textarea').evaluateAll((t) => t.map((x) => x.value));
  const o0 = await rowOrder();
  const head0 = page.locator('#board > .note').first().locator('.note-head');
  assert.equal(await head0.evaluate((h) => getComputedStyle(h).cursor), 'grab', 'the header shows a grab cursor');
  assert.equal(await head0.locator('.note-grip').count(), 1, 'the header has a grip cue');
  const rh = await head0.boundingBox();
  const lastBox = await page.locator('#board > .note').last().boundingBox();
  await page.mouse.move(rh.x + rh.width / 2, rh.y + rh.height / 2); // the grip in the middle of the header
  await page.mouse.down();
  await page.mouse.move(lastBox.x + lastBox.width - 10, lastBox.y + 60, { steps: 10 });
  assert.equal(await page.locator('#board > .note.drop-after').count(), 1, 'a bar marks the drop spot after the last note');
  await page.mouse.up();
  assert.deepEqual(await rowOrder(), [o0[1], o0[2], o0[0]], 'dragging a note in the row reorders it');
  await page.evaluate(() => focusNote(notes.length - 1));
  await page.keyboard.press('Alt+ArrowLeft');
  assert.deepEqual(await rowOrder(), [o0[1], o0[0], o0[2]], 'Alt+Left moves the focused note earlier in the row');
  assert.equal(await page.evaluate(() => document.activeElement.closest('.note').note.text), o0[0], 'and keeps it focused');
  await page.evaluate(() => apply({ layout: 'board' }));
  await page.evaluate(() => api.resetSettings());
  await page.waitForTimeout(500);
  assert.equal(readData().settings.layout, 'row');
  assert.equal(readData().tabs[0].columns.length, 3, 'reset keeps columns');
  assert.equal(readData().notes.length, 3, 'reset keeps notes');
  await app.close();
  fs.writeFileSync(dataFile, JSON.stringify({ notes: [{ id: 'x', text: 'hi', color: 0 }], columns: [{ id: 'a', name: '' }] }));
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('textarea');
  await page.evaluate(() => apply({ layout: 'board' }));
  assert.deepEqual(await colNames(), ['To do', 'Doing', 'Done'], 'invalid columns fall back to defaults');
  await app.close();

  // ---- organising: checklist progress, labels, filter, sort, archive, recurring, tabs, reminders ----
  fs.writeFileSync(dataFile, JSON.stringify({ notes: [
    { id: 'a', text: 'Alpha\n- [ ] one\n- [x] two', color: 0, created: 1, updated: 3 },
    { id: 'b', text: 'Bravo', color: 1, created: 2, updated: 2 },
  ] }));
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('.note');
  const texts = () => page.evaluate(() => visible().map((n) => n.text.split('\n')[0]));
  const noteA = page.locator('.note').first();

  // #12 checklist progress: "1/2", ticking the last box completes it
  assert.equal(await noteA.locator('.progress').textContent(), '☑ 1/2');
  assert(await page.locator('.note').nth(1).locator('.progress').isHidden(), 'no tasks, no badge');
  await page.locator('.note').nth(1).locator('.view').click(); // edit Bravo so Alpha renders
  await noteA.locator('.view input[type=checkbox]').first().click();
  assert.equal(await noteA.locator('.progress').textContent(), '☑ 2/2');
  assert(await cls(noteA.locator('.progress'), 'complete'));

  // #7 labels: create from a note, shown as a chip, saved
  await noteA.locator('.label-btn').click();
  await page.keyboard.type('Action');
  await page.keyboard.press('Enter');
  assert.deepEqual(await noteA.locator('.chips .chip').allTextContents(), ['Action']);
  await page.waitForTimeout(500);
  assert.deepEqual(readData().labels.map((l) => l.name), ['Action']);
  assert.deepEqual(readData().notes[0].labels, [readData().labels[0].id]);

  // #11 search and filter: text, label chip, quick filter; Esc clears
  await page.keyboard.press('Control+f');
  assert(await page.locator('#filterbar').isVisible(), 'Ctrl+F opens the filter bar');
  await page.keyboard.type('brav');
  assert.deepEqual(await texts(), ['Bravo']);
  assert.equal(await page.locator('#fcount').textContent(), '1 of 2');
  await page.keyboard.press('Escape');
  assert(await page.locator('#filterbar').isHidden());
  assert.deepEqual(await texts(), ['Alpha', 'Bravo'], 'Esc clears the filter');
  assert(await visible(app), 'and does not hide the window');
  await noteA.locator('.chips .chip').click(); // a label chip filters by that label
  assert.deepEqual(await texts(), ['Alpha']);
  await page.click('#fclose');
  await page.evaluate(() => { notes[1].due = '2020-01-01T09:00'; save(); render(); });
  await page.keyboard.press('Control+f');
  await page.locator('#quick .chip', { hasText: 'Overdue' }).click();
  assert.deepEqual(await texts(), ['Bravo'], 'quick filter: overdue');
  await page.click('#fclose');

  // #9 sort, once, with undo
  await page.click('#sort');
  await page.locator('#sort-menu button', { hasText: 'Due date' }).click();
  assert.deepEqual(await texts(), ['Bravo', 'Alpha'], 'sorted by due date (none last)');
  await page.click('#undo');
  assert.deepEqual(await texts(), ['Alpha', 'Bravo'], 'undo restores the order');
  await page.click('#sort');
  await page.locator('#sort-menu button', { hasText: 'Oldest first' }).click();
  assert.deepEqual(await texts(), ['Alpha', 'Bravo']);

  // #8 archive: × archives (undo), the archive view restores or deletes for good; an empty note is just deleted
  await page.locator('.note').nth(1).locator('button[title="Archive note"]').click();
  assert.deepEqual(await texts(), ['Alpha']);
  assert.equal(await page.locator('#archive').textContent(), 'Archive (1)');
  await page.click('#archive');
  assert.equal(await page.locator('.archived-note').count(), 1);
  assert.match(await page.locator('.archived-note').textContent(), /Bravo/);
  await page.getByRole('button', { name: 'Restore' }).click();
  assert.equal(await page.locator('.archived-note').count(), 0);
  await page.keyboard.press('Escape'); // Esc leaves the archive view first
  assert(await visible(app));
  assert.deepEqual(await texts(), ['Alpha', 'Bravo'], 'restored');
  await page.locator('.note').nth(1).locator('button[title="Archive note"]').click();
  await page.click('#archive');
  const del = page.locator('.archived-note').getByRole('button', { name: 'Delete' });
  await del.click();
  assert.equal(await page.locator('.archived-note').count(), 1, 'the first click only arms Delete');
  await page.locator('.archived-note').getByRole('button', { name: 'Click again' }).click();
  assert.equal(await page.locator('.archived-note').count(), 0);
  await page.getByRole('button', { name: 'Back to notes' }).click();
  await page.waitForTimeout(500);
  assert.deepEqual(readData().notes.map((n) => n.id), ['a'], 'deleted for good');
  await page.keyboard.press('Control+n');
  await page.locator('.note').nth(1).locator('button[title="Archive note"]').click();
  assert.equal(await page.evaluate(() => notes.length), 1, 'an empty note is deleted, not archived');

  // #6 recurring: set in the due popover; ✓ rolls the date forward and unticks tasks instead of finishing
  await noteA.locator('.due').click();
  await page.locator('.due-pop input[type=date]').fill('2020-01-06');
  await page.locator('.due-pop input[type=time]').fill('09:00');
  await page.locator('.due-pop select').selectOption('weekly');
  await page.keyboard.press('Escape');
  assert.match(await noteA.locator('.due').textContent(), /↻/);
  await noteA.locator('button[title="Mark done"]').click();
  const rolled = await page.evaluate(() => notes[0]);
  assert(!rolled.done, 'a recurring note stays open');
  assert(new Date(rolled.due) > new Date(), `rolled into the future (${rolled.due})`);
  assert.equal(new Date(rolled.due).getDay(), 1, 'still on a Monday');
  assert.equal(rolled.due.slice(10), 'T09:00', 'same time');
  assert.equal(Time_checklist(rolled.text), '0/2', 'tasks unticked');
  await page.click('#undo');
  assert.equal(await page.evaluate(() => notes[0].due), '2020-01-06T09:00', 'undo puts the date back');

  // #10 tabs: add and name one, it has its own notes and columns, Ctrl+1/2 switch, drop a note on a tab to move it
  await page.click('.tab-add');
  await page.keyboard.type('Meeting');
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.locator('#tabs .tab').allTextContents(), ['Notes', 'Meeting']);
  assert.deepEqual(await texts(), [''], 'a new tab starts with one empty note');
  await page.click('#layout'); // this tab only becomes a board
  assert.equal(await page.locator('#layout').textContent(), 'Layout: Board');
  await page.locator('.col-name').first().click();
  await page.keyboard.type('Agenda'); await page.keyboard.press('Enter');
  await page.keyboard.press('Control+1');
  assert.deepEqual(await texts(), ['Alpha']);
  assert.equal(await page.locator('.col').count(), 0, 'each tab has its own layout: Notes is still a row');
  assert.equal(await page.locator('#layout').textContent(), 'Layout: Row');
  await page.click('#layout');
  assert.equal(await page.locator('.col-name').first().textContent(), 'To do', 'each tab has its own columns');
  const gBox = await page.locator('.note-grip').first().boundingBox(); // the grip lets presses through to the header
  const tBox = await page.locator('#tabs .tab', { hasText: 'Meeting' }).boundingBox();
  await page.mouse.move(gBox.x + gBox.width / 2, gBox.y + gBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(tBox.x + tBox.width / 2, tBox.y + tBox.height / 2, { steps: 10 });
  assert(await cls(page.locator('#tabs .tab', { hasText: 'Meeting' }), 'drop-tab'), 'the tab lights up as a drop target');
  await page.mouse.up();
  await page.keyboard.press('Control+2');
  assert.deepEqual((await texts()).sort(), ['', 'Alpha'], 'the dropped note moved to that tab');
  assert.equal(await page.evaluate(() => colOf(notes.find((n) => n.id === 'a')).name), 'Agenda', 'into its first column');
  await page.waitForTimeout(500);
  assert.deepEqual(readData().tabs.map((t) => t.name), ['Notes', 'Meeting']);
  assert.equal(readData().activeTab, readData().tabs[1].id, 'the active tab is remembered');
  await page.locator('.tab-x').click(); // delete the Meeting tab, then undo
  assert.deepEqual(await page.locator('#tabs .tab').allTextContents(), ['Notes']);
  await page.click('#undo');
  assert.deepEqual(await page.locator('#tabs .tab').allTextContents(), ['Notes', 'Meeting']);
  await page.waitForTimeout(500);
  assert.deepEqual(readData().tabs.map((t) => t.layout), ['board', 'board'], 'tab layouts are saved');
  await page.click('#layout'); // Notes back to a row for the reminder checks

  // #2 reminders: a timed note due inside the lead time is reminded once; a tray/notification click opens its tab
  await page.keyboard.press('Control+1');
  await page.evaluate(() => {
    const d = new Date(Date.now() + 5 * 60e3);
    const p = (x) => String(x).padStart(2, '0');
    notes.push({ ...newNote(), id: 'rem', text: 'Call Sam', due: `${Time.toDateStr(d)}T${p(d.getHours())}:${p(d.getMinutes())}` });
    save();
    render();
  });
  await page.waitForTimeout(1800); // saves are followed by a reminder check
  const sent = await app.evaluate(() => globalThis.stickydropReminders);
  assert.deepEqual(sent.map((r) => [r.id, r.title]), [['rem', 'Call Sam']], 'reminded 10 minutes ahead (the default)');
  await page.keyboard.press('Control+2');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('focus-note', 'rem'));
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => tab.name), 'Notes', 'clicking a reminder switches to its tab');
  assert.equal(await page.evaluate(() => document.activeElement.closest('.note')?.note.id), 'rem', 'and focuses the note');
  await page.waitForTimeout(500);
  assert.equal(readData().reminded.rem, readData().notes.find((n) => n.id === 'rem').due, 'remembered, so it fires once');
  await app.close();

  // ---- content and data: images, export / import / restore, sync folder ----
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8Dwn4GBgYGJAQoAAP//AwB0AQL/1lRHmgAAAABJRU5ErkJggg==';
  // the next native dialog returns this path (the main process's dialog functions are swapped for the test)
  const nextDialog = (paths) => app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: p });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p[0] });
  }, paths);
  fs.writeFileSync(dataFile, JSON.stringify({ version: 3, notes: [{ id: 'img', text: 'Screens', color: 0, created: 1, updated: 1 }] }));
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('textarea');

  // #15 paste a screenshot: stored as a file, linked in the text, rendered via sdimg:, click opens it
  await page.locator('.note textarea').first().focus();
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    document.querySelector('.note textarea').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, PNG);
  await page.waitForFunction(() => notes[0].text.includes('attachment:'));
  const imgName = await page.evaluate(() => /attachment:([\w-]+\.png)/.exec(notes[0].text)[1]);
  assert.match(await page.evaluate(() => notes[0].text), /^Screens\n!\[image\]\(attachment:[\w-]+\.png\)\n$/, 'inserted at the cursor on its own line');
  assert(fs.existsSync(path.join(dir, 'attachments', imgName)), 'the image is stored next to the notes');
  await page.keyboard.press('Control+n'); // leave the note so it renders
  const loaded = () => page.locator('.note').first().locator('img.md-img').evaluate((i) => i.complete && i.naturalWidth);
  await page.waitForFunction(() => document.querySelector('img.md-img')?.complete);
  assert.equal(await loaded(), 2, 'the stored image loads through the app\'s own protocol');
  // dropping an image file onto a note adds it too; a non-image is refused
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'diagram.png', { type: 'image/png' }));
    document.querySelectorAll('.note')[1].dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, PNG);
  await page.waitForFunction(() => notes[1].text.includes('attachment:'));
  assert.match(await page.evaluate(() => notes[1].text), /^!\[diagram\]\(attachment:/, 'alt text from the file name');
  // web images (https) render; other schemes stay text
  await page.evaluate(() => { notes[1].text = '![web](https://example.com/a.png) ![bad](javascript:alert(1)) ![f](file:///etc/x.png)'; render(); });
  const srcs = await page.locator('.note').nth(1).locator('img').evaluateAll((l) => l.map((i) => i.getAttribute('src')));
  assert.deepEqual(srcs, ['https://example.com/a.png'], 'only https and stored images become images');
  await page.evaluate(() => apply({ webImages: false })); // "Load web images" off
  assert.equal(await page.locator('.note').nth(1).locator('img').count(), 0, 'web images off: none shown');
  assert.equal(await page.locator('.note').nth(1).locator('a.img-link').first().getAttribute('href'), 'https://example.com/a.png', 'a link instead');
  assert.equal(await loaded(), 2, 'stored images still show');
  await page.evaluate(() => apply({ webImages: true }));
  assert.equal(await page.locator('.note').nth(1).locator('img').count(), 1, 'and back on');
  await page.evaluate(() => { notes.pop(); render(); save(); });

  // #16 export every tab as Markdown, with images copied alongside
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'stickydrop-export-'));
  await nextDialog([out]);
  const ex = await page.evaluate(() => api.exportMarkdown());
  assert.deepEqual(ex.files, ['Notes.md']);
  assert.match(fs.readFileSync(path.join(out, 'Notes.md'), 'utf8'), new RegExp(`^# Notes\n\nScreens\n!\\[image\\]\\(attachments/${imgName}\\)`));
  assert(fs.existsSync(path.join(out, 'attachments', imgName)), 'images are exported next to the Markdown');
  // backup, then import Markdown files, then restore the backup (two clicks) and get the old notes back
  const bak = path.join(out, 'backup.json');
  await nextDialog([bak]);
  await page.evaluate(() => api.exportBackup());
  assert.equal(JSON.parse(fs.readFileSync(bak, 'utf8')).notes[0].text.startsWith('Screens'), true);
  fs.writeFileSync(path.join(out, 'agenda.md'), '﻿# Agenda\r\n- one\r\n');
  fs.writeFileSync(path.join(out, 'empty.txt'), '  \n');
  await nextDialog([path.join(out, 'agenda.md'), path.join(out, 'empty.txt')]);
  await page.keyboard.press('Control+,');
  await page.getByRole('tab', { name: 'Data' }).click();
  await page.locator('#data-set').getByRole('button', { name: 'Import…' }).click();
  await page.waitForFunction(() => notes.some((n) => n.text === '# Agenda\n- one'));
  assert.match(await page.locator('.data-status').textContent(), /Imported 1 note into "Notes"/, 'empty files are skipped');
  await nextDialog([bak]);
  const restoreBtn = page.locator('#data-set').getByRole('button', { name: 'Restore…' });
  await restoreBtn.click();
  assert.equal(await page.evaluate(() => notes.length), 2, 'the first click only arms Restore');
  await page.locator('#data-set').getByRole('button', { name: 'Click again' }).click();
  await page.waitForFunction(() => !notes.some((n) => n.text.startsWith('# Agenda')));
  assert.match(await page.locator('.data-status').textContent(), /Restored 1 notes/);
  assert(fs.readdirSync(dir).some((f) => f.startsWith('data.json.before-restore-')), 'a safety copy is kept');

  // #17 sync folder: notes (not settings) go to the folder; a change made there shows up; restarts read from it
  const sync = fs.mkdtempSync(path.join(os.tmpdir(), 'stickydrop-sync-'));
  const shared = () => JSON.parse(fs.readFileSync(path.join(sync, 'data.json'), 'utf8'));
  await nextDialog([sync]);
  await page.locator('#data-set').getByRole('button', { name: 'Choose folder…' }).click();
  await page.waitForFunction(() => document.querySelector('#data-set')?.textContent.includes('Stop syncing'));
  assert.deepEqual(Object.keys(shared()).sort(), ['labels', 'notes', 'tabs', 'version'], 'settings stay on this computer');
  assert.equal(shared().notes[0].text.split('\n')[0], 'Screens');
  assert(fs.existsSync(path.join(sync, 'attachments', imgName)), 'images move to the sync folder');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('img.md-img')?.complete);
  assert.equal(await loaded(), 2, 'and still load from there');
  const other = shared(); // "another computer" adds a note
  other.notes.push({ id: 'remote', text: 'From the laptop', color: 2, tab: other.tabs[0].id, created: 1, updated: 1 });
  fs.writeFileSync(path.join(sync, 'data.json'), JSON.stringify(other));
  await page.waitForFunction(() => notes.some((n) => n.id === 'remote'), null, { timeout: 5000 });
  assert.match(await page.locator('#toast-msg').textContent(), /another computer/);
  assert(await page.locator('#undo').isHidden(), 'nothing to undo');
  await page.locator('.note').first().locator('textarea:visible, .view:visible').click(); // edit mode or rendered, whichever shows
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.waitForTimeout(600);
  assert.equal(shared().notes[0].text.endsWith('!'), true, 'local edits are written to the folder');
  // a sync arriving while typing: an older copy of the note being edited doesn't win, and focus/cursor stay put
  await page.keyboard.type('?');
  const stale = shared();
  stale.notes[0].text = stale.notes[0].text.replace(/!$/, '');
  stale.notes.push({ id: 'remote2', text: 'Another', color: 1, tab: stale.tabs[0].id, created: 1, updated: 1 });
  fs.writeFileSync(path.join(sync, 'data.json'), JSON.stringify(stale));
  await page.waitForFunction(() => notes.some((n) => n.id === 'remote2'), null, { timeout: 5000 });
  assert.match(await page.evaluate(() => notes[0].text), /!\?$/, 'the note being typed in keeps this computer\'s text');
  assert.equal(await page.evaluate(() => document.activeElement.closest('.note')?.note === notes[0] && document.activeElement.selectionStart === notes[0].text.length), true, 'still typing at the same place');
  await page.keyboard.type('.');
  await page.waitForTimeout(600);
  assert.match(shared().notes[0].text, /!\?\.$/, 'and that version is what syncs');
  await app.close();
  assert.equal(readData().syncDir, sync, 'the folder is remembered (locally)');
  fs.writeFileSync(path.join(sync, 'data.json'), JSON.stringify({ ...shared(), notes: [...shared().notes, { id: 'later', text: 'Synced while closed', color: 0 }] }));
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('.note');
  assert(await page.evaluate(() => notes.some((n) => n.id === 'later')), 'startup reads the folder');
  // a second folder that already has notes: the user chooses whose to keep
  const sync2 = fs.mkdtempSync(path.join(os.tmpdir(), 'stickydrop-sync-'));
  fs.writeFileSync(path.join(sync2, 'data.json'), JSON.stringify({ notes: [{ id: 'z', text: 'Theirs', color: 0 }], tabs: [{ id: 'main', name: 'Notes' }] }));
  await nextDialog([sync2]);
  await page.keyboard.press('Control+,');
  await page.getByRole('tab', { name: 'Data' }).click();
  await page.locator('#data-set').getByRole('button', { name: 'Change…' }).click();
  await page.locator('#data-set').getByRole('button', { name: 'Use those notes' }).click();
  await page.waitForFunction(() => notes.length === 1 && notes[0].text === 'Theirs');
  await page.locator('#data-set').getByRole('button', { name: 'Stop syncing' }).click();
  await page.waitForFunction(() => document.querySelector('#data-set')?.textContent.includes('this computer only'));
  await page.waitForTimeout(500);
  assert.equal(readData().syncDir, undefined);
  assert.equal(readData().notes[0].text, 'Theirs', 'stopping keeps the notes here');
  await app.close();

  // ---- auto-scroll while dragging near an edge ----
  // a narrow window with 8 columns (most off-screen) and a tall first column. Drags start in the first column: on a small
  // screen (CI's macOS is 1024px wide) even the second column can be partly outside the window.
  const cols8 = Array.from({ length: 8 }, (_, i) => ({ id: 'c' + i, name: 'Col ' + i }));
  const tall = Array.from({ length: 8 }, (_, i) => ({ id: 't' + i, text: 'T' + i, color: 0, col: 'c0' }));
  fs.writeFileSync(dataFile, JSON.stringify({ settings: { layout: 'board', widthPct: 40 }, columns: cols8, notes: [{ id: 'm', text: 'M', color: 1, col: 'c0' }, ...tall] }));
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('.col .note');
  const scrollOf = (sel, axis) => page.locator(sel).first().evaluate((e, a) => e[a], axis);
  const boardBox = await page.locator('#board').boundingBox();
  const mHead = await page.locator('.col').first().locator('.note-grip').first().boundingBox();
  await page.mouse.move(mHead.x + mHead.width / 2, mHead.y + mHead.height / 2);
  await page.mouse.down();
  await page.mouse.move(boardBox.x + boardBox.width - 4, boardBox.y + 60, { steps: 10 }); // rest at the right edge
  await page.waitForTimeout(1500);
  assert(await scrollOf('#board', 'scrollLeft') > 0, 'resting at the right edge scrolls the board sideways');
  const lastCol = await page.locator('.col').last().boundingBox();
  assert(lastCol.x + lastCol.width <= boardBox.x + boardBox.width + 1, 'until the last column is in view');
  await page.mouse.move(lastCol.x + lastCol.width / 2, lastCol.y + 80, { steps: 5 });
  await page.mouse.up();
  assert.deepEqual(await page.locator('.col').last().locator('textarea').evaluateAll((t) => t.map((x) => x.value)), ['M'], 'the note drops into the column scrolled into view');
  // up and down inside a tall column
  await page.evaluate(() => { board.scrollLeft = 0; });
  const t0Head = await page.locator('.col').first().locator('.note-grip').first().boundingBox();
  const c0 = await page.locator('.col').first().boundingBox();
  await page.mouse.move(t0Head.x + t0Head.width / 2, t0Head.y + t0Head.height / 2);
  await page.mouse.down();
  await page.mouse.move(c0.x + c0.width / 2, c0.y + c0.height - 4, { steps: 10 }); // rest at the column's bottom edge
  await page.waitForTimeout(800);
  assert(await scrollOf('.col', 'scrollTop') > 0, 'resting at a column\'s bottom edge scrolls it down');
  await page.mouse.up(); // drop it at the bottom: the redraw keeps the column where it was scrolled to
  assert(await scrollOf('.col', 'scrollTop') > 0, 'a drop does not jump the column back to the top');
  await app.close();

  // ---- drag the edge to resize; the height is remembered ----
  fs.writeFileSync(dataFile, JSON.stringify({ notes: [{ id: 'x', text: 'hi', color: 0 }] }));
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('#grip');
  const height = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds().height);
  const h0 = await height();
  const g = await page.locator('#grip').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + 5);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, g.y + 45, { steps: 6 });
  await page.mouse.move(g.x + g.width / 2, g.y + 105, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const h1 = await height();
  assert(Math.abs(h1 - (h0 + 100)) <= 4, `dragging the grip 100px resizes (${h0} -> ${h1})`);
  const pct = readData().settings.heightPct;
  assert(pct > 40 && pct < 100, `height saved as a percentage (${pct})`);
  await app.close();
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('#grip');
  assert(Math.abs((await height()) - h1) <= 4, 'resized height survives a restart');
  await page.locator('#grip').dblclick();
  await page.waitForTimeout(500);
  assert(Math.abs((await height()) - h0) <= 4, 'double-click resets to the default height');
  const noteW = () => page.locator('.note').first().evaluate((x) => Math.round(x.getBoundingClientRect().width));
  assert.equal(await noteW(), 420, 'a lone note is capped at the default width');
  await page.evaluate(() => apply({ noteWidth: 300 }));
  assert.equal(await noteW(), 300, 'note width setting applies');
  await page.evaluate(() => apply({ noteWidth: 5000 }));
  assert.equal(await noteW(), 800, 'note width is clamped to the maximum');
  // minimum width: many notes stop squeezing at the minimum and the row scrolls instead
  await page.evaluate(() => apply({ noteWidth: 420 }));
  await page.evaluate(() => { for (let i = 0; i < 12; i++) notes.push({ ...newNote(), text: 'n' + i }); render(); });
  const widths = () => page.locator('#board > .note').evaluateAll((els) => els.map((x) => Math.round(x.getBoundingClientRect().width)));
  assert((await widths()).every((w) => w === 300), 'notes stop at the default 300px minimum');
  assert(await page.evaluate(() => board.scrollWidth > board.clientWidth), 'and the row scrolls');
  await page.evaluate(() => apply({ noteMinWidth: 380 }));
  assert((await widths()).every((w) => w === 380), 'the minimum is adjustable');
  await page.evaluate(() => apply({ noteMinWidth: 600, noteWidth: 300 }));
  assert((await widths()).every((w) => w === 600), 'a maximum below the minimum gives way to the minimum');
  // a new tab starts on the Default layout setting, not the current tab's layout
  await page.click('#layout');
  assert.equal(await page.locator('#layout').textContent(), 'Layout: Board');
  await page.click('.tab-add');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#layout').textContent(), 'Layout: Row', 'new tabs start as a row of notes');
  await app.close();

  console.log('OK');
})().catch((e) => { console.error(e); process.exit(1); });
