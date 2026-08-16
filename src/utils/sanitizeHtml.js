/**
 * V3.58 — XSS sanitization for the legacy `window.openModal` content bridge
 * (ContentModal). The `contentHTML` templates are system-generated (statements,
 * sensitive-fields unlock modal), but their inputs can carry stored/user data
 * (customer names, notes, sync errors). This dependency-free sanitizer keeps the
 * markup the templates actually need while removing every executable vector:
 *   - strips <script>/<style>/<iframe>/<object>/<embed>/<form>… (style/template
 *     content dropped, others unwrapped);
 *   - strips every on* attribute (onclick/onerror/…);
 *   - drops href/src/action… that are not safe URLs (no javascript:/data:/…);
 *   - sanitizes style="" by removing url()/expression()/-moz-binding/behavior.
 * Falls back to a regex scrub when no DOM is available (pure node).
 */

const DROP_TAGS = new Set([
  'script', 'style', 'template', 'noscript',
  'iframe', 'frame', 'frameset', 'object', 'embed',
  'link', 'meta', 'base', 'svg', 'math',
  'img', 'picture', 'canvas', 'video', 'audio', 'source', 'track', 'form',
]);

const SAFE_TAGS = new Set([
  'a', 'abbr', 'article', 'aside', 'b', 'blockquote', 'br', 'button',
  'caption', 'code', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em',
  'figcaption', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'hr', 'i', 'input', 'ins', 'label', 'li', 'main', 'mark', 'ol', 'p',
  'pre', 'q', 'section', 'select', 'small', 'span', 'strong', 'sub',
  'summary', 'sup', 'table', 'tbody', 'td', 'textarea', 'tfoot', 'th',
  'thead', 'tr', 'u', 'ul',
]);

const SAFE_ATTRS = new Set([
  'class', 'id', 'title', 'dir', 'lang', 'colspan', 'rowspan', 'align',
  'type', 'name', 'value', 'placeholder', 'maxlength', 'readonly', 'disabled',
  'required', 'checked', 'selected', 'for', 'autocomplete', 'size', 'min',
  'max', 'rows', 'cols', 'style',
]);

const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'background', 'poster']);

function isSafeUrl(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return true;
  if (s.startsWith('#')) return true;
  if (s.startsWith('/')) return true;
  if (s.startsWith('http://') || s.startsWith('https://')) return true;
  if (s.startsWith('mailto:') || s.startsWith('tel:')) return true;
  if (/^[\w./-]+$/.test(s)) return true;
  return false;
}

function sanitizeStyle(css) {
  return String(css || '')
    .replace(/url\s*\([^)]*\)/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/-moz-binding\s*:[^;]*/gi, '')
    .replace(/behavior\s*:[^;]*/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function appendSafeNode(sourceNode, target) {
  if (sourceNode.nodeType === 3) {
    target.appendChild(document.createTextNode(sourceNode.nodeValue));
    return;
  }
  if (sourceNode.nodeType !== 1) return;
  const tag = sourceNode.tagName.toLowerCase();

  // script/style/template: drop the node AND its content (never unwrap).
  if (tag === 'script' || tag === 'style' || tag === 'template') return;

  // DROP_TAGS / unknown tags: unwrap (keep safe children) instead of keeping them.
  if (DROP_TAGS.has(tag) || !SAFE_TAGS.has(tag)) {
    for (const child of Array.from(sourceNode.childNodes)) appendSafeNode(child, target);
    return;
  }

  const el = document.createElement(tag);
  for (const attr of Array.from(sourceNode.attributes)) {
    const name = attr.name.toLowerCase();
    if (name.startsWith('on')) continue;
    if (URL_ATTRS.has(name)) {
      if (isSafeUrl(attr.value)) el.setAttribute(name, attr.value);
      continue;
    }
    if (name === 'style') {
      el.setAttribute('style', sanitizeStyle(attr.value));
      continue;
    }
    if (SAFE_ATTRS.has(name)) el.setAttribute(name, attr.value);
  }
  for (const child of Array.from(sourceNode.childNodes)) appendSafeNode(child, el);
  target.appendChild(el);
}

/** Regex fallback for DOM-less environments (pure node). */
function scrubWithoutDom(source) {
  return String(source)
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:href|src|action|formaction)\s*=\s*["']?\s*javascript:[^"'>\s]*/gi, '')
    .replace(/url\s*\([^)]*\)/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '');
}

export function sanitizeHtml(html) {
  if (html == null) return '';
  const source = String(html);
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return scrubWithoutDom(source);
  }
  try {
    let root;
    if (typeof document.createElement === 'function' && typeof document.createElement('template').content !== 'undefined') {
      const template = document.createElement('template');
      template.innerHTML = source;
      root = template.content;
    } else if (typeof DOMParser !== 'undefined') {
      const parsed = new DOMParser().parseFromString(source, 'text/html');
      root = parsed.body;
    } else {
      return scrubWithoutDom(source);
    }
    const out = document.createElement('div');
    for (const child of Array.from(root.childNodes)) appendSafeNode(child, out);
    return out.innerHTML;
  } catch {
    return scrubWithoutDom(source);
  }
}
