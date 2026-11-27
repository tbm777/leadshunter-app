// One modern style for every dropdown: each <select class="input"> gets a custom button and list.
// The real <select> stays in the page (hidden) and is kept in sync, so existing "change" handlers keep working.
const CHEV = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let open = null;   // { sel, btn, pop, hi, q }

function label(sel) { const o = sel.options[sel.selectedIndex]; return o ? o.text : ''; }
function sync(sel) {
  const btn = sel.nextElementSibling; if (!btn || !btn.classList.contains('ns-btn')) return;
  const o = sel.options[sel.selectedIndex];
  btn.querySelector('.ns-v').textContent = label(sel);
  btn.classList.toggle('ns-ph', !o || o.value === '');
  btn.disabled = sel.disabled;
}
function enhance(sel) {
  if (sel.dataset.ns || sel.multiple) return;
  sel.dataset.ns = '1';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'ns-btn ' + [...sel.classList].filter(c => c !== 'input').join(' ');
  btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
  if (sel.id) { btn.id = 'ns-' + sel.id; const l = document.querySelector(`label[for="${CSS.escape(sel.id)}"]`); if (l) { l.htmlFor = btn.id; btn.setAttribute('aria-label', l.textContent.trim()); } }
  if (sel.getAttribute('style')) btn.setAttribute('style', sel.getAttribute('style'));
  btn.innerHTML = `<span class="ns-v"></span>${CHEV}`;
  sel.classList.add('ns-hidden'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
  sel.insertAdjacentElement('afterend', btn);
  sync(sel);
}
function scan(root = document) { root.querySelectorAll('select.input:not([data-ns])').forEach(enhance); }

function render() {
  const { sel, pop } = open, q = open.q.toLowerCase();
  const opts = [...sel.options].map((o, i) => ({ o, i })).filter(({ o }) => !q || o.text.toLowerCase().includes(q));
  open.list = opts;
  open.hi = Math.max(0, Math.min(open.hi, opts.length - 1));
  pop.querySelector('.ns-list').innerHTML = opts.length ? opts.map(({ o, i }, k) => `<div class="ns-opt ${i === sel.selectedIndex ? 'on' : ''} ${k === open.hi ? 'hi' : ''} ${o.disabled ? 'dis' : ''} ${o.value === '' ? 'ph' : ''}" role="option" aria-selected="${i === sel.selectedIndex}" data-i="${i}"><span>${esc(o.text)}</span>${i === sel.selectedIndex ? CHECK : ''}</div>`).join('') : '<div class="ns-empty">No match</div>';
  pop.querySelector('.ns-opt.hi')?.scrollIntoView({ block: 'nearest' });
}
function place() {
  const { btn, pop } = open, r = btn.getBoundingClientRect();
  const below = innerHeight - r.bottom, h = Math.min(320, pop.scrollHeight);
  pop.style.minWidth = r.width + 'px';
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px';
  if (below < h + 12 && r.top > below) { pop.style.top = ''; pop.style.bottom = (innerHeight - r.top + 6) + 'px'; }
  else { pop.style.bottom = ''; pop.style.top = (r.bottom + 6) + 'px'; }
}
function show(sel, btn) {
  close();
  const pop = document.createElement('div');
  pop.className = 'ns-pop'; pop.setAttribute('role', 'listbox');
  const many = sel.options.length > 8;
  pop.innerHTML = `${many ? '<div class="ns-search"><input class="input" placeholder="Search" autocomplete="off"></div>' : ''}<div class="ns-list"></div>`;
  document.body.appendChild(pop);
  open = { sel, btn, pop, hi: Math.max(0, sel.selectedIndex), q: '' };
  btn.setAttribute('aria-expanded', 'true'); btn.classList.add('open');
  render(); place();
  if (many) setTimeout(() => pop.querySelector('input').focus(), 0);
}
function close(focus) {
  if (!open) return;
  open.pop.remove(); open.btn.setAttribute('aria-expanded', 'false'); open.btn.classList.remove('open');
  if (focus) open.btn.focus();
  open = null;
}
function choose(i) {
  const { sel } = open, o = sel.options[i];
  if (!o || o.disabled) return;
  const changed = sel.selectedIndex !== i;
  sel.selectedIndex = i; sync(sel); close(true);
  if (changed) { sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
}

export function installSelects() {
  scan();
  // New dropdowns appear whenever a page or dialog renders: enhance them as they arrive.
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches?.('select.input')) enhance(n); else if (n.querySelector) scan(n); }
    if (open && !document.body.contains(open.btn)) close();
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.ns-btn');
    if (btn) { const sel = btn.previousElementSibling; if (open && open.btn === btn) close(); else if (sel && !btn.disabled) show(sel, btn); return; }
    const opt = e.target.closest('.ns-opt');
    if (opt && open) { choose(+opt.dataset.i); return; }
    if (open && !e.target.closest('.ns-pop')) close();
  }, true);
  document.addEventListener('change', (e) => { if (e.target.matches?.('select[data-ns]')) sync(e.target); });
  document.addEventListener('input', (e) => { if (open && e.target.closest('.ns-search')) { open.q = e.target.value; open.hi = 0; render(); } });
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!open) {
      if (t.classList?.contains('ns-btn') && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); show(t.previousElementSibling, t); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open.hi += e.key === 'ArrowDown' ? 1 : -1; render(); return; }
    if (e.key === 'Enter') { e.preventDefault(); const it = open.list[open.hi]; if (it) choose(it.i); return; }
    if (e.key === 'Tab') { close(); return; }
    // Type to jump when there's no search box.
    if (e.key.length === 1 && !open.pop.querySelector('.ns-search') && !e.metaKey && !e.ctrlKey) {
      const k = open.list.findIndex(({ o }) => o.text.toLowerCase().startsWith(e.key.toLowerCase()));
      if (k >= 0) { open.hi = k; render(); }
    }
  }, true);
  addEventListener('resize', () => close());
  addEventListener('scroll', (e) => { if (open && !e.target.closest?.('.ns-pop')) place(); }, true);
}
