// Pure-logic checks for timeutil.js. Run: node test/time.test.js
const assert = require('assert');
const T = require('../timeutil');

const now = new Date(2026, 10, 14, 10, 0); // Sat 14 Nov 2026 10:00 local

// parseDue
assert.equal(T.parseDue('2026-11-14T17:00').getHours(), 17);
assert.equal(T.parseDue('2026-11-14').getHours(), 23, 'date-only means end of that day');
for (const bad of ['', 'tomorrow', '2026-13-45', '2026-11-14T25:00x', null, undefined, 42]) assert.equal(T.parseDue(bad), null, String(bad));
assert.equal(T.toDateStr(new Date(2026, 0, 5)), '2026-01-05');

// dueState
const st = (due, extra = {}) => T.dueState({ due, ...extra }, now);
assert.equal(st(undefined), 'none');
assert.equal(st('2026-11-13T09:00'), 'overdue');
assert.equal(st('2026-11-13'), 'overdue', 'date-only yesterday');
assert.equal(st('2026-11-14'), 'today', 'date-only today is not overdue yet');
assert.equal(st('2026-11-14T09:59'), 'overdue');
assert.equal(st('2026-11-14T17:00'), 'today');
assert.equal(st('2026-11-15T09:00'), 'soon', '23h away but tomorrow');
assert.equal(st('2026-11-15T11:00'), 'later', 'more than 24h away');
assert.equal(st('2026-11-13', { done: true }), 'none', 'done notes never nag');

// dueLabel
const lb = (s) => T.dueLabel(s, now);
assert.equal(lb('2026-11-14T17:00'), 'Today 17:00');
assert.equal(lb('2026-11-14'), 'Today');
assert.equal(lb('2026-11-15'), 'Tomorrow');
assert.equal(lb('2026-11-13T08:05'), 'Yesterday 08:05');
assert.equal(lb('2026-11-17'), 'Tue');
assert.equal(lb('2026-12-25'), '25 Dec');
assert.equal(lb('2027-01-05'), '5 Jan 2027');
assert.equal(lb('junk'), '');

// ageFraction
const t0 = now.getTime();
assert.equal(T.ageFraction(t0, now, 14), 0);
assert.equal(T.ageFraction(t0 - 7 * 864e5, now, 14), 0.5);
assert.equal(T.ageFraction(t0 - 99 * 864e5, now, 14), 1, 'clamped');
assert.equal(T.ageFraction(t0 + 5000, now, 14), 0, 'clock skew never goes negative');

// ago
const a = (ms) => T.ago(t0 - ms, now);
assert.equal(a(30e3), 'just now');
assert.equal(a(5 * 60e3), '5m ago');
assert.equal(a(3 * 3600e3), '3h ago');
assert.equal(a(2 * 864e5), '2d ago');
assert.equal(a(21 * 864e5), '3w ago');
assert.equal(a(120 * 864e5), '4mo ago');

// noteTitle
assert.equal(T.noteTitle('\n\n# **Standup** notes\nmore'), 'Standup notes');
assert.equal(T.noteTitle('- [ ] call Sam'), 'call Sam');
assert.equal(T.noteTitle('xylophone'), 'xylophone', 'does not eat a leading x');
assert.equal(T.noteTitle('   '), '(empty note)');
assert.equal(T.noteTitle('a'.repeat(60)).length, 40);

// summarize: counts only overdue + today, soonest first, ignoring done/undated/later
const s = T.summarize([
  { id: 'later', due: '2026-12-01' },
  { id: 'today', due: '2026-11-14T17:00' },
  { id: 'old', due: '2026-11-10' },
  { id: 'done', due: '2026-11-10', done: true },
  { id: 'none' },
  { id: 'gone', due: '2026-11-14T09:00' },
], now);
assert.deepEqual([s.overdue, s.today], [2, 1]);
assert.deepEqual(s.items.map((x) => x.note.id), ['old', 'gone', 'today']);

console.log('time.test OK');
