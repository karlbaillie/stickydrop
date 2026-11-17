// Drives the real app with an isolated data dir. Run: npm test
const { _electron: electron } = require('playwright-core');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stickydrop-test-'));
const dataFile = path.join(dir, 'data.json');
const readData = () => JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const launch = () => electron.launch({
  args: [path.join(__dirname, '..'), '--no-sandbox'],
  env: { ...process.env, STICKYDROP_DATA: dir, STICKYDROP_SHOW: '1' },
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
  await page.locator('.note-head button[title="Delete note"]').nth(1).click();
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
  await page.locator('.note-head button[title="Delete note"]').nth(2).click();
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
  assert.deepEqual(await page.evaluate(() => notes.map((n) => n.text)), ['second note', 'scratch', 'standup: ship it']);
  await page.evaluate(() => { notes.unshift(notes.pop()); notes[0].done = false; save(); render(); apply({ doneSink: false }); });
  await page.locator('.note-head button[title="Delete note"]').nth(2).click();
  assert.deepEqual(await page.evaluate(() => notes.map((n) => n.text)), ['standup: ship it', 'second note']);

  // settings: height + hotkey change + invalid hotkey is rejected
  await page.keyboard.press('Control+,');
  await page.locator('#s-heightPct').fill('60');
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
  await set({ opacity: 100, fontSize: 17, font: 'hand', showToolbar: true, theme: 'dark', palette: 'classic' });
  assert.equal(await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors), true);
  await page.waitForTimeout(500);
  assert.equal(readData().settings.heightPct, 60);

  // the settings form is generated from the schema: every control present
  await page.keyboard.press('Control+,');
  await page.waitForSelector('#s-palette');
  assert(await page.locator('#settings-body [id^="s-"]:not(output)').count() >= 17);
  assert.equal(await page.locator('#s-display option').count() >= 2, true);

  // settings stay usable in a short window: buttons visible, body scrolls if needed
  await set({ heightPct: 15 });
  await page.waitForTimeout(300);
  const fit = await page.evaluate(() => {
    const f = document.getElementById('settings-form').getBoundingClientRect();
    const d = document.getElementById('settings-close').getBoundingClientRect();
    const b = document.getElementById('settings-body');
    return { formBottom: f.bottom, vh: innerHeight, doneBottom: d.bottom, scrolls: b.scrollHeight > b.clientHeight };
  });
  assert(fit.formBottom <= fit.vh && fit.doneBottom <= fit.vh, 'form and Done button fit in the window');
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
  if (d.settings.hotkey === 'F9') {
    assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('F9')), true);
    assert.equal(await page.locator('#hotkey').textContent(), 'F9');
  } else { // F9 held by another running StickyDrop: everything else reset and the user is told why
    assert.match(await page.locator('#settings-err').textContent(), /taken/);
  }
  assert.equal(await page.locator('#s-opacity').inputValue(), '100');
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--pct')), '100%');
  assert.deepEqual(d.notes.map((n) => n.text), ['standup: ship it', 'second note'], 'notes kept');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(dir, 'shot.png') });
  console.log('screenshot', path.join(dir, 'shot.png'));
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
  await page.getByRole('button', { name: '+ Column' }).click();
  await page.keyboard.type('Review'); await page.keyboard.press('Enter');
  assert.deepEqual(await colNames(), ['Backlog', 'Doing', 'Done', 'Review']);
  await page.waitForTimeout(500);
  assert.deepEqual(readData().columns.map((c) => c.name), ['Backlog', 'Doing', 'Done', 'Review']);
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
  const saved = readData().columns;
  assert.deepEqual(saved.map((c) => c.name), ['Backlog', 'Review', 'Done']);
  assert.equal(saved[2].collapsed, true);
  assert.equal(saved[2].color, 3); // swatch 0 is "no colour"
  assert.equal(saved[0].limit, 1);

  // persists across restart; switching to Row keeps every note; reset keeps columns and notes
  await page.waitForTimeout(500);
  await app.close();
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('.col');
  assert.deepEqual(await colNames(), ['Backlog', 'Review', 'Done']);
  await setLayout('row');
  assert.deepEqual(await page.locator('textarea').evaluateAll((t) => t.map((x) => x.value)).then((v) => v.sort()), ['A', 'B', 'C']);
  await page.evaluate(() => apply({ layout: 'board' }));
  await page.evaluate(() => api.resetSettings());
  await page.waitForTimeout(500);
  assert.equal(readData().settings.layout, 'row');
  assert.equal(readData().columns.length, 3, 'reset keeps columns');
  assert.equal(readData().notes.length, 3, 'reset keeps notes');
  await app.close();
  fs.writeFileSync(dataFile, JSON.stringify({ notes: [{ id: 'x', text: 'hi', color: 0 }], columns: [{ id: 'a', name: '' }] }));
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('textarea');
  await page.evaluate(() => apply({ layout: 'board' }));
  assert.deepEqual(await colNames(), ['To do', 'Doing', 'Done'], 'invalid columns fall back to defaults');
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
  await app.close();

  console.log('OK');
})().catch((e) => { console.error(e); process.exit(1); });
