// Pure date/age/note helpers shared by the renderer (script tag) and main (require), unit-tested in test/time.test.js.
// A note's `due` is a local string: "YYYY-MM-DD" (due by end of that day) or "YYYY-MM-DDTHH:mm".
// `repeat` (optional): daily | weekdays | weekly | monthly. `archived` (optional): when it was archived (ms).
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

  // what the tray shows: counts plus the overdue/today notes, soonest first (archived notes don't count)
  function summarize(notes, now) {
    const items = notes
      .filter((n) => !n.archived)
      .map((n) => ({ note: n, state: dueState(n, now) }))
      .filter((x) => x.state === 'overdue' || x.state === 'today')
      .sort((a, b) => parseDue(a.note.due) - parseDue(b.note.due));
    return {
      overdue: items.filter((x) => x.state === 'overdue').length,
      today: items.filter((x) => x.state === 'today').length,
      items,
    };
  }

  // "- [ ] x" / "* [x] y" task lines outside fenced code blocks: { done, total }
  function checklist(text) {
    let done = 0, total = 0, fenced = false;
    for (const line of String(text).split('\n')) {
      if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
      const m = !fenced && /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]/.exec(line);
      if (m) { total++; if (m[1] !== ' ') done++; }
    }
    return { done, total };
  }

  // Recurring notes: the next due string after the current one that is still ahead (timed: after `now`; date-only:
  // after today), keeping the time of day.
  // Monthly keeps the day of the month, clamped to short months (31 Jan -> 28/29 Feb -> 31 Mar).
  const REPEATS = { daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly', monthly: 'Monthly' };
  function nextDue(due, repeat, now) {
    const d = parseDue(due);
    if (!d || !REPEATS[repeat]) return null;
    const time = due.length > 10 ? due.slice(10) : '';
    const day0 = Number(due.slice(8, 10));
    let y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
    const step = () => {
      if (repeat === 'monthly') {
        m++;
        day = Math.min(day0, new Date(y, m + 1, 0).getDate()); // Date normalises m > 11 into the next year
      } else if (repeat === 'weekly') day += 7;
      else do day++; while (repeat === 'weekdays' && [0, 6].includes(new Date(y, m, day).getDay()));
      const n = new Date(y, m, day);
      y = n.getFullYear(); m = n.getMonth(); day = n.getDate();
    };
    let next;
    const later = (s) => (time ? parseDue(s) > now : s > toDateStr(now)); // a date-only note done today covers today
    do { step(); next = `${y}-${pad(m + 1)}-${pad(day)}${time}`; } while (!later(next));
    return next;
  }

  // Which notes need a reminder now: timed due dates only, `leadMin` minutes early, at most once per due value
  // (`reminded` maps note id -> the due it was reminded for), and never for something more than a day late.
  function remindersDue(notes, reminded, now, leadMin) {
    return notes.filter((n) => {
      if (n.done || n.archived || typeof n.due !== 'string' || n.due.length <= 10 || reminded[n.id] === n.due) return false;
      const at = parseDue(n.due);
      return at && now >= at - leadMin * 6e4 && now - at < DAY;
    });
  }

  return { parseDue, toDateStr, dueState, dueLabel, ageFraction, ago, noteTitle, summarize, checklist, REPEATS, nextDue, remindersDue };
})();
if (typeof module === 'object') module.exports = Time;
