// Merge tags highlighted inside message boxes: a mirror layer behind a transparent textarea paints a soft pill under each
// tag (unknown bracketed words get a warning tint). The textarea keeps its own text, caret and selection.
import { isMergeTag } from './personalize.js';

const SEL = 'textarea.mbody, textarea.sheet-body';
const RE = /\{\{\s*([\w -]+?)\s*\}\}|\[([\w -]+?)\]|\{([\w -]+?)\}/g;
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const COPY = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textIndent', 'textTransform', 'wordSpacing', 'tabSize',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing', 'borderRadius'];

function paint(ta) {
  const back = ta.previousElementSibling; if (!back || !back.classList.contains('hl-back')) return;
  let html = '', last = 0;
  for (const m of ta.value.matchAll(RE)) {
    html += esc(ta.value.slice(last, m.index));
    html += `<mark class="${isMergeTag(m[1] || m[2] || m[3]) ? 'hl-tag' : 'hl-bad'}">${esc(m[0])}</mark>`;
    last = m.index + m[0].length;
  }
  back.innerHTML = html + esc(ta.value.slice(last)) + '\n';
  back.scrollTop = ta.scrollTop;
}
function wrap(ta) {
  if (ta.dataset.hl) return; ta.dataset.hl = '1';
  const cs = getComputedStyle(ta), w = document.createElement('div'), back = document.createElement('div');
  w.className = 'hl-wrap'; back.className = 'hl-back'; back.setAttribute('aria-hidden', 'true');
  for (const k of COPY) back.style[k] = cs[k];
  ta.parentNode.insertBefore(w, ta); w.append(back, ta);
  ta.classList.add('hl-ta');
  ta.addEventListener('scroll', () => { back.scrollTop = ta.scrollTop; });
  paint(ta);
}
const scan = root => root.querySelectorAll?.(SEL).forEach(wrap);
new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches(SEL)) wrap(n); else scan(n); } })
  .observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('input', e => { if (e.target.matches?.(SEL)) paint(e.target); }, true);
// Values set from code (inserting a tag) repaint too.
document.addEventListener('click', () => requestAnimationFrame(() => document.querySelectorAll('.hl-ta').forEach(paint)), true);
scan(document);
