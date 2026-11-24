// Pure-logic checks for sync.js. Run: node test/sync.test.js
const assert = require('assert');
const { merge } = require('../sync');

const n = (id, text, updated = 1) => ({ id, text, updated });
const tabs = [{ id: 'main', name: 'Notes', columns: [] }];
const base = { notes: [n('a', 'A'), n('b', 'B'), n('c', 'C')], tabs, labels: [] };
const ids = (m) => m.notes.map((x) => `${x.id}:${x.text}`);

// each side changes a different note: both changes kept
assert.deepEqual(ids(merge(base,
  { ...base, notes: [n('a', 'A here', 5), n('b', 'B'), n('c', 'C')] },
  { ...base, notes: [n('a', 'A'), n('b', 'B there', 6), n('c', 'C')] })), ['a:A here', 'b:B there', 'c:C']);
// both change the same note: the newer edit wins, either way round
assert.deepEqual(ids(merge(base, { ...base, notes: [n('a', 'mine', 9), n('b', 'B'), n('c', 'C')] },
  { ...base, notes: [n('a', 'theirs', 7), n('b', 'B'), n('c', 'C')] })), ['a:mine', 'b:B', 'c:C']);
assert.deepEqual(ids(merge(base, { ...base, notes: [n('a', 'mine', 7), n('b', 'B'), n('c', 'C')] },
  { ...base, notes: [n('a', 'theirs', 9), n('b', 'B'), n('c', 'C')] })), ['a:theirs', 'b:B', 'c:C']);
// additions on both sides are kept (theirs after mine)
assert.deepEqual(ids(merge(base, { ...base, notes: [...base.notes, n('x', 'X')] }, { ...base, notes: [...base.notes, n('y', 'Y')] })),
  ['a:A', 'b:B', 'c:C', 'x:X', 'y:Y']);
// deletions: honoured unless the other side edited the note since
assert.deepEqual(ids(merge(base, { ...base, notes: [n('a', 'A'), n('c', 'C')] }, base)), ['a:A', 'c:C'], 'deleted here');
assert.deepEqual(ids(merge(base, base, { ...base, notes: [n('a', 'A'), n('c', 'C')] })), ['a:A', 'c:C'], 'deleted there');
assert.deepEqual(ids(merge(base, { ...base, notes: [n('a', 'A'), n('b', 'B edited', 4), n('c', 'C')] }, { ...base, notes: [n('a', 'A'), n('c', 'C')] })),
  ['a:A', 'b:B edited', 'c:C'], 'edited here, deleted there: kept');
// tabs / labels: whichever side changed; both changed: this computer's
const t2 = [...tabs, { id: 't2', name: 'Work', columns: [] }];
assert.deepEqual(merge(base, base, { ...base, tabs: t2 }).tabs, t2);
assert.deepEqual(merge(base, { ...base, labels: [{ id: 'l' }] }, base).labels, [{ id: 'l' }]);
assert.deepEqual(merge(base, { ...base, tabs: [] }, { ...base, tabs: t2 }).tabs, []);
// no base (first sync): everything from both sides, nothing deleted
assert.deepEqual(ids(merge(null, { notes: [n('a', 'A')] }, { notes: [n('b', 'B')] })), ['a:A', 'b:B']);

console.log('sync.test OK');
