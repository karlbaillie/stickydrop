// Tiny Markdown -> DOM renderer for notes. Nodes are built with textContent only (never innerHTML),
// so note text can't inject markup or script. Covers what meeting notes need: headings, bold/italic/
// strike, inline + fenced code, lists (nested, ordered, task checkboxes), quotes, rules, links.
// Not covered: tables, images, raw HTML (shown as plain text).
(() => {
  const h = (tag, props, ...kids) => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
  };

  // groups: 1-2 code, 3/4 bold, 5 strike, 6/7 italic, 8-9 [text](url), 10 bare url
  const INLINE = /(`+)(.+?)\1|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*(.+?)\*|(?<!\w)_(.+?)_(?!\w)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)])/g;

  function inline(text, parent) {
    const re = new RegExp(INLINE.source, 'g'); // fresh state: this function recurses
    let last = 0, m;
    while ((m = re.exec(text))) {
      parent.append(text.slice(last, m.index));
      last = re.lastIndex;
      const wrap = (tag, s) => { const e = h(tag); inline(s, e); parent.append(e); };
      if (m[2] !== undefined) parent.append(h('code', { textContent: m[2] }));
      else if (m[3] !== undefined || m[4] !== undefined) wrap('strong', m[3] ?? m[4]);
      else if (m[5] !== undefined) wrap('del', m[5]);
      else if (m[6] !== undefined || m[7] !== undefined) wrap('em', m[6] ?? m[7]);
      else if (m[9] !== undefined) parent.append(h('a', { href: m[9], target: '_blank', rel: 'noreferrer', textContent: m[8] }));
      else parent.append(h('a', { href: m[10], target: '_blank', rel: 'noreferrer', textContent: m[10] }));
    }
    parent.append(text.slice(last));
  }

  window.renderMarkdown = (src) => {
    const out = document.createDocumentFragment();
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    let para = [];
    let list = null; // stack of { indent, el, tag } for nested lists

    const flush = () => {
      if (!para.length) return;
      const p = h('p');
      para.forEach((l, k) => { if (k) p.append(h('br')); inline(l, p); }); // notes are line-oriented: keep line breaks
      out.append(p);
      para = [];
    };
    const endBlock = () => { flush(); list = null; };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;

      if (/^```/.test(line)) {
        endBlock();
        const code = [];
        for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) code.push(lines[i]);
        out.append(h('pre', {}, h('code', { textContent: code.join('\n') })));
      } else if (!line.trim()) {
        endBlock();
      } else if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
        endBlock();
        const e = h('h' + m[1].length);
        inline(m[2], e);
        out.append(e);
      } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        endBlock();
        out.append(h('hr'));
      } else if (/^>/.test(line)) {
        endBlock();
        const q = h('blockquote');
        for (let first = true; i < lines.length && /^>/.test(lines[i]); i++, first = false) {
          if (!first) q.append(h('br'));
          inline(lines[i].replace(/^>\s?/, ''), q);
        }
        i--;
        out.append(q);
      } else if ((m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line))) {
        flush();
        const indent = m[1].replace(/\t/g, '    ').length;
        const tag = /\d/.test(m[2]) ? 'ol' : 'ul';
        list ||= [];
        while (list.length && list.at(-1).indent > indent) list.pop();
        let top = list.at(-1);
        if (top && top.indent === indent && top.tag !== tag) { list.pop(); top = list.at(-1); } // other list type: start fresh
        if (!top || top.indent < indent) {
          const el = h(tag);
          (top ? top.el.lastElementChild : out).append(el); // deeper lists nest inside the previous <li>
          list.push({ indent, el, tag });
        }
        const li = h('li');
        const t = /^\[( |x|X)\]\s+(.*)$/.exec(m[3]);
        if (t) {
          const cb = h('input', { type: 'checkbox', checked: t[1] !== ' ' });
          cb.dataset.line = i; // lets the renderer flip the [ ] in the source
          li.className = t[1] === ' ' ? 'task' : 'task done';
          li.append(cb, ' ');
          inline(t[2], li);
        } else {
          inline(m[3], li);
        }
        list.at(-1).el.append(li);
      } else {
        list = null;
        para.push(line);
      }
    }
    flush();
    return out;
  };
})();
