// Regenerates the README screenshots in docs/ from sample data in a throwaway profile.
// Run: node scripts/screenshots.js   (needs a display; never touches your real notes)
const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

const D = 864e5;
const now = Date.now();
const p2 = (n) => String(n).padStart(2, '0');
const day = (t) => { const d = new Date(t); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };

const base = {
  a: { id: 'a', color: 0, created: now - 3 * D, updated: now - 120e3, due: day(now - D) + 'T09:00',
    text: '# Sprint review\n**Attendees:** Sam, Priya, Lee\n\n## Actions\n- [x] Send roadmap\n- [ ] Book review with *finance*\n- [ ] Ping `#infra` about the outage' },
  b: { id: 'b', color: 1, created: now - 2 * D, updated: now - 5 * 3600e3, due: day(now) + 'T17:30',
    text: '## Decisions\n1. Ship **Friday**\n2. Cut the beta scope\n\n> "Keep it simple" - Lee\n\nSpec: https://example.com/spec' },
  c: { id: 'c', color: 2, created: now - 20 * D, updated: now - 13 * D,
    text: '# Old idea\nSomething I wrote two weeks ago and forgot about.' },
  d: { id: 'd', color: 3, created: now - 4 * D, updated: now - 4 * D, done: true, due: day(now - 2 * D),
    text: '# Shipped\nrelease notes are out' },
  e: { id: 'e', color: 4, created: now - 60e3, updated: now - 5e3,
    text: 'still typing...\n- [ ] edit mode shows raw Markdown' },
};

async function shoot(name, notes, settings, act, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-shots-'));
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ settings, notes, ...extra }));
  const app = await electron.launch({
    args: [path.join(__dirname, '..'), '--no-sandbox'],
    env: { ...process.env, STICKYDROP_DATA: dir, STICKYDROP_SHOW: '1' },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('.note');
  await page.evaluate(() => apply({ widthPct: 60 }));
  await page.waitForTimeout(400);
  await page.evaluate(() => document.activeElement.blur()); // notes render as Markdown unless being edited
  if (act) await act(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(__dirname, '..', 'docs', name + '.png'), scale: 'css' });
  await app.close();
}

(async () => {
  const dark = { heightPct: 45 };
  await shoot('hero', [base.a, base.b, base.c, base.e], dark, (page) => page.evaluate(() => focusNote(3)));
  await shoot('light', [base.a, base.b, base.c, base.d], { ...dark, theme: 'light', palette: 'pastel', aging: 'vintage', font: 'sans' });
  await shoot('due', [base.a, base.b, base.c, base.d], dark, async (page) => {
    await page.locator('.note').first().locator('.due').click();
  });
  await shoot('board', [base.a, { ...base.b, col: 'doing' }, { ...base.c, col: 'doing' }, { ...base.d, col: 'done' }, { ...base.e, col: 'todo' }],
    { heightPct: 55, widthPct: 100, layout: 'board' }, null, {
      columns: [{ id: 'todo', name: 'To do', color: 4, limit: 1 }, { id: 'doing', name: 'Doing', color: 1 }, { id: 'done', name: 'Done', done: true, color: 3 }] });
  await shoot('settings', [base.a, base.b, base.c, base.d], { heightPct: 85 }, (page) => page.evaluate(() => openSettings()));
  console.log('wrote docs/*.png');
})().catch((e) => { console.error(e); process.exit(1); });
