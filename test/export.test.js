// Pure-logic checks for exporter.js. Run: node test/export.test.js
const assert = require('assert');
const X = require('../exporter');

const now = new Date(2026, 10, 14, 10, 0);
const labels = [{ id: 'l1', name: 'Action', color: 0 }, { id: 'l2', name: 'Question', color: 4 }];

// attachments referred to by a note
assert.deepEqual(X.attachmentsIn('a ![x](attachment:ab-12.png) b ![](attachment:c.JPG) ![w](https://e.com/x.png)'), ['ab-12.png', 'c.JPG']);
assert.deepEqual(X.attachmentsIn('attachment:../../etc/passwd attachment:x.exe'), [], 'only plain image names');
assert(X.NAME_RE.test('lk2-ab3.webp') && !X.NAME_RE.test('../a.png') && !X.NAME_RE.test('a.svg'));

// safe file names
assert.equal(X.safeName('Weekly: sync / notes?'), 'Weekly sync notes');
assert.equal(X.safeName('   '), 'note');
assert.equal(X.safeName('x'.repeat(100)).length, 60);

// a note as Markdown: images become relative paths, metadata on its own line
const n = { id: 'a', text: '# Plan\n![shot](attachment:k1.png)\n', due: '2026-11-14T17:00', repeat: 'weekly', labels: ['l2', 'gone'], done: true };
assert.equal(X.noteMarkdown(n, labels, now), '# Plan\n![shot](attachments/k1.png)\n\n_Due Today 17:00 (repeats weekly) · Labels: Question · Done_');
assert.equal(X.noteMarkdown({ text: 'plain' }, labels, now), 'plain', 'no metadata, no extra line');

// a tab as a document: board tabs grouped by column, archived notes last, other tabs' notes left out
const tab = { id: 't', name: 'Work', columns: [{ id: 'todo', name: 'To do' }, { id: 'done', name: 'Done', done: true }] };
const notes = [
  { id: '1', tab: 't', text: 'one', col: 'todo' },
  { id: '2', tab: 't', text: 'two', col: 'done', done: true },
  { id: '3', tab: 'other', text: 'elsewhere' },
  { id: '4', tab: 't', text: 'old', archived: 5 },
  { id: '5', tab: 't', text: 'lost column', col: 'nope' },
];
assert.equal(X.tabMarkdown(tab, notes, labels, now, 'board'),
  '# Work\n\n## To do\n\none\n\n---\n\nlost column\n\n## Done\n\ntwo\n\n_Done_\n\n## Archived\n\nold\n');
assert.equal(X.tabMarkdown(tab, notes, labels, now, 'row'), '# Work\n\none\n\n---\n\ntwo\n\n_Done_\n\n---\n\nlost column\n\n## Archived\n\nold\n');

console.log('export.test OK');
