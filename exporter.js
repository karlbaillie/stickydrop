// Pure helpers for images (attachments) and Markdown export, shared by main and unit-tested in test/export.test.js.
// An attachment is an image file stored next to the notes; a note refers to it as ![alt](attachment:NAME).
const Time = require('./timeutil');

const ATTACH_RE = /attachment:([\w-]+\.(?:png|jpe?g|gif|webp))/gi;
const NAME_RE = /^[\w-]+\.(?:png|jpe?g|gif|webp)$/i; // what a stored attachment's file name may look like
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

// every attachment name a text refers to
const attachmentsIn = (text) => [...String(text).matchAll(ATTACH_RE)].map((m) => m[1]);

// file names: no path separators or characters Windows refuses; never empty
const safeName = (s, fallback = 'note') => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || fallback;

// a note's metadata as one italic line under it (due, repeat, labels, done), or '' if it has none
function metaLine(n, labels, now) {
  const bits = [];
  if (n.due) bits.push(`Due ${Time.dueLabel(n.due, now)}${n.repeat ? ` (repeats ${Time.REPEATS[n.repeat]?.toLowerCase() || n.repeat})` : ''}`);
  const names = (n.labels || []).map((id) => labels.find((l) => l.id === id)?.name).filter(Boolean);
  if (names.length) bits.push(`Labels: ${names.join(', ')}`);
  if (n.done) bits.push('Done');
  return bits.length ? `_${bits.join(' · ')}_` : '';
}

// one note as Markdown; attachment:NAME becomes a relative path so the file renders in other Markdown apps
function noteMarkdown(n, labels, now, imageDir = 'attachments') {
  const text = String(n.text).replace(ATTACH_RE, (_, name) => `${imageDir}/${name}`).trimEnd();
  const meta = metaLine(n, labels, now);
  return meta ? `${text}\n\n${meta}` : text;
}

// one tab as a Markdown document: notes in order (grouped by column for a board), archived ones at the end
function tabMarkdown(tab, notes, labels, now, layout) {
  const mine = notes.filter((n) => n.tab === tab.id && !n.archived);
  const archived = notes.filter((n) => n.tab === tab.id && n.archived);
  const join = (list) => list.map((n) => noteMarkdown(n, labels, now)).join('\n\n---\n\n');
  const parts = [`# ${tab.name}`];
  if (layout === 'board') {
    const colOf = (n) => tab.columns.find((c) => c.id === n.col) || tab.columns[0];
    for (const c of tab.columns) {
      const inCol = mine.filter((n) => colOf(n) === c);
      if (inCol.length) parts.push(`## ${c.name}`, join(inCol));
    }
  } else if (mine.length) parts.push(join(mine));
  if (archived.length) parts.push('## Archived', join(archived));
  return parts.join('\n\n') + '\n';
}

module.exports = { ATTACH_RE, NAME_RE, IMAGE_TYPES, attachmentsIn, safeName, metaLine, noteMarkdown, tabMarkdown };
