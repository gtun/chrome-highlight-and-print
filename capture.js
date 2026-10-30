// Injected into the page on demand. Builds a self-contained, style-inlined copy of the
// current selection: only highlighted text is kept, but the formatting of the elements
// around it, and any images that sit visually inside the highlighted area, come along too.
(() => {
  if (window.__highlightPrintCapture) return;

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Inherited properties: only written when they differ from the parent element.
  const INHERITED = [
    'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
    'font-stretch', 'font-feature-settings', 'line-height', 'letter-spacing', 'word-spacing',
    'text-align', 'text-indent', 'text-transform', 'text-shadow', 'white-space', 'word-break',
    'overflow-wrap', 'hyphens', 'direction', 'list-style-type', 'list-style-position',
    'list-style-image', 'border-collapse', 'border-spacing', 'caption-side', 'quotes', 'tab-size',
  ];
  // Non-inherited properties: only written when they differ from the browser default for the tag.
  const BOX = [
    'display', 'float', 'clear', 'vertical-align', 'unicode-bidi', 'box-sizing',
    'text-decoration-line', 'text-decoration-color', 'text-decoration-style',
    'text-decoration-thickness',
    'background-color', 'background-image', 'background-size', 'background-position',
    'background-repeat',
    'border-top-width', 'border-top-style', 'border-top-color',
    'border-right-width', 'border-right-style', 'border-right-color',
    'border-bottom-width', 'border-bottom-style', 'border-bottom-color',
    'border-left-width', 'border-left-style', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius',
    'border-bottom-right-radius', 'border-bottom-left-radius',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'opacity', 'object-fit', 'object-position',
    'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content',
    'align-self', 'flex-grow', 'flex-shrink', 'flex-basis', 'row-gap', 'column-gap', 'order',
    'column-count',
  ];
  const SVG_INHERITED = [
    'color', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
    'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'font-family', 'font-size',
    'font-weight', 'text-anchor', 'visibility',
  ];
  const SVG_BOX = ['display', 'opacity', 'stop-color', 'stop-opacity'];

  const SKIP_TAGS = new Set([
    'script', 'style', 'noscript', 'template', 'link', 'meta', 'iframe', 'object', 'embed',
    'dialog', 'head', 'title',
  ]);
  const KEEP_EMPTY = new Set(['br', 'hr', 'wbr']);
  const KEEP_ATTRS = [
    'href', 'alt', 'title', 'colspan', 'rowspan', 'start', 'reversed', 'type', 'value',
    'dir', 'lang', 'scope', 'headers', 'span', 'datetime', 'cite', 'abbr', 'checked',
  ];

  // ---------- default styles (from a pristine about:blank frame) ----------

  let defaultsFrame = null;
  const defaultsCache = new Map();

  function defaultsFor(el, props) {
    const key = `${el.namespaceURI}|${el.localName}`;
    if (!defaultsCache.has(key)) {
      if (!defaultsFrame) {
        defaultsFrame = document.createElement('iframe');
        defaultsFrame.style.cssText =
          'position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none';
        document.documentElement.appendChild(defaultsFrame);
      }
      const doc = defaultsFrame.contentDocument;
      const probe = doc.createElementNS(el.namespaceURI || 'http://www.w3.org/1999/xhtml',
        el.localName);
      doc.body.appendChild(probe);
      const cs = defaultsFrame.contentWindow.getComputedStyle(probe);
      const snap = {};
      for (const p of [...BOX, ...SVG_BOX]) snap[p] = cs.getPropertyValue(p);
      probe.remove();
      defaultsCache.set(key, snap);
    }
    return defaultsCache.get(key);
  }

  // ---------- style serialisation ----------

  function styleText(el, cs, parentCS, ctx, { wrapper = false, svg = false } = {}) {
    const inherited = svg ? SVG_INHERITED : INHERITED;
    const box = svg ? SVG_BOX : BOX;
    const parts = [];
    for (const p of inherited) {
      const v = cs.getPropertyValue(p);
      if (!v || (parentCS && parentCS.getPropertyValue(p) === v)) continue;
      if (p === 'font-family') ctx.families.add(v);
      parts.push(`${p}:${v}`);
    }
    if (!wrapper) {
      const def = defaultsFor(el, box);
      for (const p of box) {
        const v = cs.getPropertyValue(p);
        if (!v || v === def[p]) continue;
        // Skip colours/styles of borders that aren't drawn.
        const side = /^border-(top|right|bottom|left)-(style|color)$/.exec(p);
        if (side && cs.getPropertyValue(`border-${side[1]}-width`) === '0px') continue;
        if (/^text-decoration-(color|style|thickness)$/.test(p) &&
            cs.textDecorationLine === 'none') continue;
        parts.push(`${p}:${v}`);
      }
    }
    let text = parts.join(';');
    // Computed url(#id) references come back absolute; make them local again.
    if (svg) text = text.split(`url("${ctx.pageUrl}#`).join('url("#');
    return text;
  }

  // ---------- geometry helpers ----------

  function overlapsBandVertically(r, band) {
    return r.bottom > band.top && r.top < band.bottom;
  }

  // Is this (unselected) visual element inside the highlighted area?
  function inBand(r, band) {
    if (r.width < 2 || r.height < 2) return false;
    if (r.width < 24 && r.height < 24) return false; // skip stray icons
    const h = Math.min(r.right, band.right) - Math.max(r.left, band.left);
    if (h <= 0) return false;
    const v = Math.min(r.bottom, band.bottom) - Math.max(r.top, band.top);
    const cy = (r.top + r.bottom) / 2;
    return (cy >= band.top && cy <= band.bottom) || v >= r.height * 0.5;
  }

  function isVisuallyHidden(cs, r) {
    if (cs.opacity === '0') return true;
    return r.width <= 1 && r.height <= 1 &&
      (cs.overflow === 'hidden' || cs.clip !== 'auto' || cs.clipPath !== 'none');
  }

  function isMedia(el, cs, r) {
    const tag = el.localName;
    if (tag === 'img' || tag === 'svg' || tag === 'video' || tag === 'canvas' ||
        tag === 'picture') return true;
    // Purely decorative boxes drawn with a CSS background image.
    return cs.backgroundImage !== 'none' && /url\(/.test(cs.backgroundImage) &&
      r.width >= 24 && r.height >= 24 && !el.textContent.trim() &&
      !el.querySelector('img,svg,video,canvas,picture');
  }

  function absUrl(u) {
    try { return new URL(u, document.baseURI).href; } catch { return u; }
  }

  // ---------- cloning ----------

  function shallowClone(el, ctx) {
    const tag = el.localName === 'body' || el.localName === 'html' ? 'div' : el.localName;
    const out = ctx.doc.createElement(tag);
    for (const name of KEEP_ATTRS) {
      if (!el.hasAttribute(name)) continue;
      let v = el.getAttribute(name);
      if (name === 'href') {
        v = absUrl(v);
        if (/^\s*javascript:/i.test(v)) continue;
      }
      out.setAttribute(name, v);
    }
    if (tag === 'input') {
      out.setAttribute('value', el.value);
      if (el.checked) out.setAttribute('checked', '');
      out.setAttribute('disabled', '');
    }
    if (tag === 'li') {
      const n = liOrdinal(el);
      if (n != null) out.setAttribute('value', String(n));
    }
    return out;
  }

  // Keep ordered-list numbering correct when earlier items are not part of the selection.
  function liOrdinal(li) {
    const ol = li.parentElement;
    if (!ol || ol.localName !== 'ol' || ol.reversed) return null;
    let n = 0;
    for (let s = li; s; s = s.previousElementSibling) {
      if (s.localName !== 'li') continue;
      if (s.hasAttribute('value')) return parseInt(s.getAttribute('value'), 10) + n;
      n++;
    }
    return ol.start + n - 1;
  }

  function sizeStyle(r) {
    const w = Math.round(r.width * 100) / 100;
    const h = Math.round(r.height * 100) / 100;
    return `;width:${w}px;height:auto;aspect-ratio:${w} / ${h};max-width:100%`;
  }

  function imgFromDataUrl(dataUrl, el, cs, parentCS, r, ctx) {
    const img = ctx.doc.createElement('img');
    img.src = dataUrl;
    img.setAttribute('style', styleText(el, cs, parentCS, ctx) + sizeStyle(r));
    return img;
  }

  function cloneMedia(el, cs, parentCS, r, ctx) {
    const tag = el.localName;

    if (tag === 'picture') {
      const img = el.querySelector('img');
      if (!img) return null;
      return cloneMedia(img, getComputedStyle(img), cs, img.getBoundingClientRect(), ctx);
    }

    if (tag === 'img') {
      const src = el.currentSrc || el.src;
      if (!src) return null;
      const out = ctx.doc.createElement('img');
      out.setAttribute('src', src);
      if (el.alt) out.setAttribute('alt', el.alt);
      out.setAttribute('style', styleText(el, cs, parentCS, ctx) + sizeStyle(r));
      ctx.images.push(out);
      return out;
    }

    if (tag === 'canvas') {
      try {
        return imgFromDataUrl(el.toDataURL(), el, cs, parentCS, r, ctx);
      } catch {
        return null; // tainted by cross-origin content
      }
    }

    if (tag === 'video') {
      try {
        const c = document.createElement('canvas');
        c.width = el.videoWidth;
        c.height = el.videoHeight;
        c.getContext('2d').drawImage(el, 0, 0);
        return imgFromDataUrl(c.toDataURL('image/jpeg', 0.92), el, cs, parentCS, r, ctx);
      } catch {
        if (!el.poster) return null;
        const out = imgFromDataUrl(absUrl(el.poster), el, cs, parentCS, r, ctx);
        ctx.images.push(out);
        return out;
      }
    }

    if (tag === 'svg') {
      const out = ctx.doc.importNode(el, true);
      inlineSvgStyles(el, out, parentCS, ctx);
      const own = out.getAttribute('style');
      out.setAttribute('style', own ? own + sizeStyle(r) : sizeStyle(r).slice(1));
      ctx.hasSvg = true;
      return out;
    }

    // Element drawn with a CSS background image.
    const out = shallowClone(el, ctx);
    out.setAttribute('style', styleText(el, cs, parentCS, ctx) +
      `;width:${r.width}px;height:${r.height}px;max-width:100%`);
    return out;
  }

  function inlineSvgStyles(orig, clone, parentCS, ctx) {
    const cs = getComputedStyle(orig);
    for (const a of [...clone.attributes]) {
      if (/^on/i.test(a.name)) clone.removeAttribute(a.name);
    }
    clone.removeAttribute('class');
    const style = styleText(orig, cs, parentCS, ctx, { svg: true });
    if (style) clone.setAttribute('style', style);
    else clone.removeAttribute('style');
    const oKids = orig.children;
    const cKids = clone.children;
    for (let i = cKids.length - 1; i >= 0; i--) {
      if (cKids[i].localName === 'script' || cKids[i].localName === 'foreignObject') {
        cKids[i].remove();
      } else {
        inlineSvgStyles(oKids[i], cKids[i], cs, ctx);
      }
    }
  }

  // ::before / ::after content (icons, custom bullets, quote marks...).
  function pseudoSpan(el, which, ctx, parentCS) {
    const cs = getComputedStyle(el, which);
    const content = cs.content;
    if (!content || content === 'none' || content === 'normal') return null;
    if (cs.position === 'absolute' || cs.position === 'fixed' || cs.display === 'none') {
      return null;
    }
    // CSS counters can't be resolved outside their original list, so leave those out.
    if (/counters?\(/.test(content)) return null;
    let text = '';
    for (const m of content.matchAll(/"((?:[^"\\]|\\.)*)"|attr\(\s*([^)\s]+)\s*\)/g)) {
      text += m[2] != null
        ? el.getAttribute(m[2]) || ''
        : m[1].replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
          .replace(/\\(.)/g, '$1');
    }
    if (!text && cs.backgroundImage === 'none') return null;
    const span = ctx.doc.createElement('span');
    span.textContent = text;
    const probe = { localName: 'span', namespaceURI: el.namespaceURI };
    let style = styleText(probe, cs, parentCS, ctx);
    if (!text && cs.width !== 'auto') style += `;width:${cs.width};height:${cs.height}`;
    span.setAttribute('style', style);
    return span;
  }

  // ---------- main tree walk ----------

  function textSlice(node, range) {
    if (!range.intersectsNode(node)) return null;
    let s = 0;
    let e = node.data.length;
    if (node === range.startContainer) s = range.startOffset;
    if (node === range.endContainer) e = range.endOffset;
    const t = node.data.slice(s, e);
    return t || null;
  }

  function build(node, parentCS, ctx) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (parentCS && parentCS.visibility === 'hidden') return null;
      const t = textSlice(node, ctx.range);
      return t ? ctx.doc.createTextNode(t) : null;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const el = node;
    if (SKIP_TAGS.has(el.localName)) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return null;
    const r = el.getBoundingClientRect();
    if (isVisuallyHidden(cs, r)) return null;

    const intersects = ctx.range.intersectsNode(el);
    // Fast reject of whole subtrees that are neither selected nor beside the selection.
    // Zero-size boxes (display:contents, collapsed float containers) are always descended.
    if (!intersects && r.width > 0 && r.height > 0 && !overlapsBandVertically(r, ctx.band)) {
      return null;
    }

    if (isMedia(el, cs, r)) {
      if (!intersects && !inBand(r, ctx.band)) return null;
      return cloneMedia(el, cs, parentCS, r, ctx);
    }
    if (el.localName === 'math') return intersects ? ctx.doc.importNode(el, true) : null;
    if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml') return null;

    const kids = [];
    for (const child of el.childNodes) {
      const c = build(child, cs, ctx);
      if (c) kids.push({ child, c });
    }
    if (!kids.length && !(intersects && KEEP_EMPTY.has(el.localName))) return null;

    // Keep a table row's column structure even when only some cells are selected.
    if (el.localName === 'tr') {
      const kept = new Set(kids.map((k) => k.child));
      for (const cell of el.children) {
        if (kept.has(cell) || (cell.localName !== 'td' && cell.localName !== 'th')) continue;
        const empty = shallowClone(cell, ctx);
        empty.setAttribute('style', styleText(cell, getComputedStyle(cell), cs, ctx));
        kids.push({ child: cell, c: empty });
      }
      const order = [...el.childNodes];
      kids.sort((a, b) => order.indexOf(a.child) - order.indexOf(b.child));
    }

    // Ancestors of the selection are just containers: keep their typography but drop
    // their page-layout box (sidebars offsets, fixed widths, headers...).
    const wrapper = el !== ctx.caEl && el.contains(ctx.caEl);
    const out = shallowClone(el, ctx);
    const style = styleText(el, cs, parentCS, ctx, { wrapper });
    if (style) out.setAttribute('style', style);

    const before = !wrapper && pseudoSpan(el, '::before', ctx, cs);
    if (before) out.appendChild(before);
    for (const { c } of kids) out.appendChild(c);
    const after = !wrapper && pseudoSpan(el, '::after', ctx, cs);
    if (after) out.appendChild(after);
    return out;
  }

  function effectiveBackground(el) {
    for (let e = el; e; e = e.parentElement) {
      const c = getComputedStyle(e).backgroundColor;
      if (c && c !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(c)) return c;
    }
    return 'rgb(255, 255, 255)';
  }

  function captureRange(range, ctx) {
    let caEl = range.commonAncestorContainer;
    if (caEl.nodeType !== Node.ELEMENT_NODE) caEl = caEl.parentElement;
    const rr = range.getBoundingClientRect();
    const col = caEl.getBoundingClientRect();
    Object.assign(ctx, {
      range,
      caEl,
      band: {
        top: rr.top,
        bottom: rr.bottom,
        left: Math.min(col.left, rr.left),
        right: Math.max(col.right, rr.right),
      },
    });
    const out = build(document.body, null, ctx);
    if (out) out.style.backgroundColor = effectiveBackground(caEl);
    return out;
  }

  // Selection inside a textarea / text input isn't exposed through getSelection().
  function captureFormField(ctx) {
    const el = document.activeElement;
    if (!el || !(el.localName === 'textarea' || el.localName === 'input')) return null;
    let s, e;
    try { s = el.selectionStart; e = el.selectionEnd; } catch { return null; }
    if (s == null || s === e) return null;
    const pre = ctx.doc.createElement('div');
    const cs = getComputedStyle(el);
    pre.setAttribute('style', styleText({ localName: 'div', namespaceURI: el.namespaceURI },
      cs, null, ctx, { wrapper: true }) + ';white-space:pre-wrap');
    pre.textContent = el.value.slice(s, e);
    return pre;
  }

  // ---------- resource inlining ----------

  async function toDataUrl(url, timeoutMs = 8000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (blob.size > 15e6) return null;
      return await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Same-origin and blob: images may need the page's cookies / origin to load, so embed
  // them. Cross-origin images load fine in the print tab as plain URLs.
  async function inlineImages(images) {
    await Promise.all(images.map(async (img) => {
      const src = img.getAttribute('src');
      let sameOrigin = false;
      try { sameOrigin = new URL(src).origin === location.origin; } catch {}
      if (!src.startsWith('blob:') && !sameOrigin) return;
      const data = await toDataUrl(src);
      if (data) img.setAttribute('src', data);
    }));
  }

  // Copy the @font-face rules for fonts actually used, embedding the font files when possible.
  async function collectFonts(families) {
    const wanted = new Set();
    for (const list of families) {
      for (const f of list.split(',')) wanted.add(f.trim().replace(/^["']|["']$/g, '').toLowerCase());
    }
    const faces = [];

    async function walk(rules, base, depth) {
      for (const rule of rules) {
        if (rule.type === CSSRule.IMPORT_RULE) {
          if (depth < 4 && rule.styleSheet) await walkSheet(rule.styleSheet, depth + 1);
        } else if (rule.type === CSSRule.FONT_FACE_RULE) {
          const fam = rule.style.getPropertyValue('font-family').trim()
            .replace(/^["']|["']$/g, '').toLowerCase();
          if (wanted.has(fam)) faces.push({ style: rule.style, base });
        } else if (rule.cssRules) {
          await walk(rule.cssRules, base, depth);
        }
      }
    }

    async function walkSheet(sheet, depth = 0) {
      const base = sheet.href || document.baseURI;
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        // Cross-origin stylesheet (e.g. a font CDN): re-fetch it so we can read it.
        if (!sheet.href) return;
        try {
          const res = await fetch(sheet.href);
          const tmp = new CSSStyleSheet();
          tmp.replaceSync((await res.text()).replace(/@import[^;]+;/g, ''));
          rules = tmp.cssRules;
        } catch {
          return;
        }
      }
      await walk(rules, base, depth);
    }

    for (const sheet of [...document.styleSheets, ...(document.adoptedStyleSheets || [])]) {
      await walkSheet(sheet);
    }

    let budget = 25e6;
    const css = await Promise.all(faces.map(async ({ style, base }) => {
      const src = style.getPropertyValue('src');
      const urls = [...src.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)\s*(format\([^)]*\))?/g)];
      if (!urls.length) return '';
      const pick = urls.find((m) => /woff2/.test(m[3] || m[2])) || urls[0];
      let abs;
      try { abs = new URL(pick[2], base).href; } catch { return ''; }
      let url = abs;
      if (budget > 0) {
        const data = await toDataUrl(abs);
        if (data) { url = data; budget -= data.length; }
      }
      const decl = [`font-family:${style.getPropertyValue('font-family')}`,
        `src:url("${url}")${pick[3] ? ' ' + pick[3] : ''}`, 'font-display:block'];
      for (const p of ['font-weight', 'font-style', 'font-stretch', 'unicode-range']) {
        const v = style.getPropertyValue(p);
        if (v) decl.push(`${p}:${v}`);
      }
      return `@font-face{${decl.join(';')}}`;
    }));
    return css.filter(Boolean).join('\n');
  }

  // Copy symbols / gradients / clip paths that captured SVGs reference by id.
  function resolveSvgRefs(container, ctx) {
    const defs = ctx.doc.createElementNS(SVG_NS, 'svg');
    defs.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
    defs.setAttribute('aria-hidden', 'true');
    const seen = new Set();
    for (let pass = 0; pass < 4; pass++) {
      const html = container.innerHTML + defs.innerHTML;
      const ids = new Set();
      for (const m of html.matchAll(/(?:href="#|url\(&quot;#|url\("#|url\(#)([^"&)\s]+)/g)) {
        ids.add(m[1]);
      }
      let added = false;
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        if (container.querySelector(`[id="${CSS.escape(id)}"]`)) continue;
        const src = document.getElementById(id);
        if (!src || src.namespaceURI !== SVG_NS) continue;
        const copy = ctx.doc.importNode(src, true);
        copy.querySelectorAll('script').forEach((s) => s.remove());
        defs.appendChild(copy);
        added = true;
      }
      if (!added) break;
    }
    if (defs.childNodes.length) container.prepend(defs);
  }

  window.__highlightPrintCapture = async () => {
    const ctx = {
      doc: document.implementation.createHTMLDocument(''), // inert: nothing loads here
      families: new Set(),
      images: [],
      hasSvg: false,
      pageUrl: location.href.split('#')[0],
    };
    try {
      const container = ctx.doc.createElement('div');
      const sel = window.getSelection();
      for (let i = 0; sel && i < sel.rangeCount; i++) {
        const range = sel.getRangeAt(i);
        if (range.collapsed) continue;
        const part = captureRange(range, ctx);
        if (part) container.appendChild(part);
      }
      if (!container.childNodes.length) {
        const field = captureFormField(ctx);
        if (field) container.appendChild(field);
      }
      if (!container.childNodes.length) return null;

      if (ctx.hasSvg) resolveSvgRefs(container, ctx);
      const [fontCss] = await Promise.all([
        collectFonts(ctx.families),
        inlineImages(ctx.images),
      ]);

      return {
        html: container.innerHTML,
        fontCss,
        title: document.title,
        url: location.href,
      };
    } finally {
      defaultsFrame?.remove();
      defaultsFrame = null;
      defaultsCache.clear();
    }
  };
})();
