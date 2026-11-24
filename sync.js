// Three-way merge for the sync folder (pure, unit-tested in test/sync.test.js).
// base: the notes part as this computer last wrote or read it in the folder; local: this computer's now;
// remote: what is in the folder now (another computer's save). Each is { notes, tabs, labels }.
// Notes merge one by one (by id): a note changed on one side takes that change, changed on both keeps the newer edit,
// added on either side is kept, deleted on one side stays deleted unless the other side edited it since.
// Tabs and labels are taken whole from whichever side changed them (this computer's if both did).
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function mergeById(base = [], local = [], remote = [], both) {
  const B = new Map(base.map((x) => [x.id, x]));
  const R = new Map(remote.map((x) => [x.id, x]));
  const L = new Set(local.map((x) => x.id));
  const out = [];
  for (const l of local) {
    const r = R.get(l.id), b = B.get(l.id);
    if (r) out.push(same(l, b) ? r : same(r, b) ? l : both(l, r));
    else if (!b || !same(l, b)) out.push(l); // new here, or edited here though deleted there
    // else: deleted on the other computer and untouched here
  }
  for (const r of remote) {
    if (L.has(r.id)) continue;
    const b = B.get(r.id);
    if (!b || !same(r, b)) out.push(r); // new there, or edited there though deleted here
  }
  return out;
}

function merge(base, local, remote) {
  base ||= { notes: [], tabs: undefined, labels: undefined };
  const pick = (k) => (same(remote[k], base[k]) ? local[k] : same(local[k], base[k]) ? remote[k] : local[k]);
  return {
    notes: mergeById(base.notes, local.notes, remote.notes, (l, r) => ((r.updated || 0) > (l.updated || 0) ? r : l)),
    tabs: pick('tabs'),
    labels: pick('labels'),
  };
}

module.exports = { merge, same };
