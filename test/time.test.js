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
assert.equal(T.summarize([{ id: 'a', due: '2026-11-13', archived: 1 }], now).overdue, 0, 'archived notes are not summarised');

// checklist progress
assert.deepEqual(T.checklist('- [ ] a\n- [x] b\n* [X] c\n+ [ ] d\n1. [x] e\n- plain\n[ ] not a task'), { done: 3, total: 5 });
assert.deepEqual(T.checklist('```\n- [ ] in code\n```\n  - [ ] nested'), { done: 0, total: 1 }, 'fenced code ignored, nested counted');
assert.deepEqual(T.checklist(''), { done: 0, total: 0 });

// recurring: next due after now, keeping the time; never in the past
const nd = (due, r, at = now) => T.nextDue(due, r, at);
assert.equal(nd('2026-11-14T09:00', 'daily'), '2026-11-15T09:00');
assert.equal(nd('2026-11-14T11:00', 'daily'), '2026-11-15T11:00', 'always moves forward even if not yet due');
assert.equal(nd('2026-11-01', 'daily'), '2026-11-15', 'catches up past missed days, date-only');
assert.equal(nd('2026-11-13T09:00', 'weekdays'), '2026-11-16T09:00', 'Fri -> Mon');
assert.equal(nd('2026-11-14', 'weekly'), '2026-11-21');
assert.equal(nd('2026-01-31', 'monthly', new Date(2026, 0, 31, 12)), '2026-02-28', 'clamped to a short month');
assert.equal(nd('2026-01-31', 'monthly', new Date(2026, 2, 1)), '2026-03-31', 'and back to the 31st after');
assert.equal(nd('2026-12-15T08:00', 'monthly', new Date(2026, 11, 20)), '2027-01-15T08:00', 'across a year');
assert.equal(nd('2026-11-14', 'never'), null);
assert.equal(nd(undefined, 'daily'), null);

// reminders: timed only, lead time, once per due value, not for something long past
const notesR = [
  { id: 'a', due: '2026-11-14T10:10' }, // in 10 min
  { id: 'b', due: '2026-11-14T10:30' }, // in 30 min
  { id: 'c', due: '2026-11-14' }, // date only: never
  { id: 'd', due: '2026-11-14T09:00', done: true },
  { id: 'e', due: '2026-11-14T09:00', archived: 5 },
  { id: 'f', due: '2026-11-12T09:00' }, // two days late: no
  { id: 'g', due: '2026-11-14T09:30' }, // 30 min late: yes
];
const ids = (r, lead) => T.remindersDue(notesR, r, now, lead).map((n) => n.id);
assert.deepEqual(ids({}, 0), ['g']);
assert.deepEqual(ids({}, 15), ['a', 'g']);
assert.deepEqual(ids({ a: '2026-11-14T10:10' }, 15), ['g'], 'already reminded for this due');
assert.deepEqual(ids({ a: '2026-11-14T08:00' }, 15), ['a', 'g'], 'a changed due reminds again');

console.log('time.test OK');
