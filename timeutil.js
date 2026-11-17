// Pure date/age helpers shared by the renderer (script tag) and main (require), unit-tested in test/time.test.js.
// A note's `due` is a local string: "YYYY-MM-DD" (due by end of that day) or "YYYY-MM-DDTHH:mm".
const Time = (() => {
  const DAY = 864e5;
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n) => String(n).padStart(2, '0');
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / DAY); // calendar days, DST-safe

  function parseDue(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(s)) return null;
    const d = new Date(s.length === 10 ? s + 'T23:59:59' : s); // no zone suffix => local time
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // none | overdue | today | soon (within 24h, not today) | later. Done notes never nag.
  function dueState(note, now) {
    const end = note.done ? null : parseDue(note.due);
    if (!end) return 'none';
    if (end < now) return 'overdue';
    if (dayDiff(end, now) === 0) return 'today';
    return end - now <= DAY ? 'soon' : 'later';
  }

  function dueLabel(s, now) {
    const d = parseDue(s);
    if (!d) return '';
    const diff = dayDiff(d, now);
    const day = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday'
      : diff > 1 && diff < 7 ? WEEKDAYS[d.getDay()]
      : `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : ''}`;
    return s.length > 10 ? `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}` : day;
  }

  // 0 = just edited, 1 = fully aged after `days` days without an edit
  const ageFraction = (updated, now, days) => Math.min(1, Math.max(0, (now - updated) / (days * DAY)));

  function ago(then, now) {
    const s = Math.max(0, (now - then) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 14 * 86400) return `${Math.floor(s / 86400)}d ago`;
    if (s < 60 * 86400) return `${Math.floor(s / (7 * 86400))}w ago`;
    return `${Math.floor(s / (30 * 86400))}mo ago`;
  }

  // first meaningful line of a note, markdown markers stripped, for the tray menu
  function noteTitle(text) {
    for (const line of String(text).split('\n')) {
      const t = line.replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, '').replace(/[*_`~]/g, '').trim();
      if (t) return t.length > 40 ? t.slice(0, 39) + '…' : t;
    }
    return '(empty note)';
  }

  // what the tray shows: counts plus the overdue/today notes, soonest first
  function summarize(notes, now) {
    const items = notes
      .map((n) => ({ note: n, state: dueState(n, now) }))
      .filter((x) => x.state === 'overdue' || x.state === 'today')
      .sort((a, b) => parseDue(a.note.due) - parseDue(b.note.due));
    return {
      overdue: items.filter((x) => x.state === 'overdue').length,
      today: items.filter((x) => x.state === 'today').length,
      items,
    };
  }

  return { parseDue, toDateStr, dueState, dueLabel, ageFraction, ago, noteTitle, summarize };
})();
if (typeof module === 'object') module.exports = Time;
