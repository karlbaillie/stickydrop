// Tiny Markdown -> DOM renderer for notes. Nodes are built with textContent only (never innerHTML),
// so note text can't inject markup or script. Covers what meeting notes need: headings, bold/italic/
// strike, inline + fenced code, lists (nested, ordered, task checkboxes), quotes, rules, links, and images: stored ones
// (![alt](attachment:NAME), pasted or dropped in) and web ones (https only). Not covered: tables, raw HTML (shown as text).
(() => {
  const h = (tag, props, ...kids) => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
  };

  // groups: 1-2 code, 3/4 bold, 5 strike, 6/7 italic, 8-9 ![alt](image), 10-11 [text](url), 12 bare url
  const INLINE = /(`+)(.+?)\1|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*(.+?)\*|(?<!\w)_(.+?)_(?!\w)|!\[([^\]]*)\]\((attachment:[\w-]+\.(?:png|jpe?g|gif|webp)|https:\/\/[^\s)]+)\)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)])/gi;

  let opts = {}; // { webImages: false } shows web images as links (set per render call)

  function inline(text, parent) {
    const re = new RegExp(INLINE.source, INLINE.flags); // fresh state: this function recurses
    let last = 0, m;
    while ((m = re.exec(text))) {
      parent.append(text.slice(last, m.index));
      last = re.lastIndex;
      const wrap = (tag, s) => { const e = h(tag); inline(s, e); parent.append(e); };
      if (m[2] !== undefined) parent.append(h('code', { textContent: m[2] }));
      else if (m[3] !== undefined || m[4] !== undefined) wrap('strong', m[3] ?? m[4]);
      else if (m[5] !== undefined) wrap('del', m[5]);
      else if (m[6] !== undefined || m[7] !== undefined) wrap('em', m[6] ?? m[7]);
      else if (m[9] !== undefined && !/^attachment:/i.test(m[9]) && opts.webImages === false) { // web images off: a link
        parent.append(h('a', { href: m[9], target: '_blank', rel: 'noreferrer', textContent: m[8] || m[9], className: 'img-link', title: 'Web image (not loaded: Settings → Notes)' }));
      } else if (m[9] !== undefined) { // an image: a stored one is served by the app (sdimg:), a web one loads over https
        const stored = /^attachment:/i.test(m[9]);
        const img = h('img', { src: stored ? 'sdimg://a/' + m[9].slice(11) : m[9], alt: m[8], loading: 'lazy', className: 'md-img', referrerPolicy: 'no-referrer' });
        if (stored) img.dataset.attachment = m[9].slice(11);
        parent.append(img);
      } else if (m[11] !== undefined) parent.append(h('a', { href: m[11], target: '_blank', rel: 'noreferrer', textContent: m[10] }));
      else parent.append(h('a', { href: m[12], target: '_blank', rel: 'noreferrer', textContent: m[12] }));
    }
    parent.append(text.slice(last));
  }

  window.renderMarkdown = (src, options = {}) => {
    opts = options;
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
