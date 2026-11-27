// LeadsHunter Form Filler. Runs on every page but only acts when opened from the Manual queue (or in a frame of such a page).
// It fills the form and points at the CAPTCHA; you solve it and press send yourself.
(() => {
  if (window.__lhFill) return; window.__lhFill = true;
  const TOP = window === window.top;
  const send = (m) => new Promise(r => { try { chrome.runtime.sendMessage(m, r); } catch { r(null); } });

  // Let LeadsHunter know the extension is installed.
  if (TOP && document.querySelector('meta[name="leadshunter-app"]')) {
    document.documentElement.dataset.lhExt = chrome.runtime.getManifest().version;
    document.dispatchEvent(new CustomEvent('lh-ext-ready'));
    return;
  }

  const SUCCESS = /(thank\s?(you|s)\b|message (has been |was )?(sent|received|delivered)|we('ll| will) (be in touch|get back|contact you|respond|reach out)|successfully (sent|submitted)|submission (received|successful)|request (has been |was )?(received|sent|submitted)|we (have|'ve) received|form (has been |was )?submitted|thanks for (reaching|contacting|getting))/i;
  const CAPTCHA = 'iframe[src*="recaptcha"],.g-recaptcha,iframe[src*="hcaptcha"],.h-captcha,iframe[src*="challenges.cloudflare.com"],.cf-turnstile,[data-sitekey]';

  /* ---------------------------------------------------------- reading the fill data */
  function readHash() {
    const m = location.hash.match(/lh-fill=([A-Za-z0-9_-]+)/);
    if (!m) return null;
    try {
      const b = m[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(escape(atob(b + '==='.slice((b.length + 3) % 4))));
      history.replaceState(null, '', location.href.replace(/#?lh-fill=[A-Za-z0-9_-]+/, '').replace(/#$/, ''));
      return JSON.parse(json);
    } catch { return null; }
  }

  /* ---------------------------------------------------------- fields */
  const vis = (el) => {
    if (!el || !el.isConnected) return false;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05 || r.width < 2 || r.height < 2 || r.right < -50 || r.bottom < -50) return false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const ps = getComputedStyle(p); if (ps.display === 'none' || ps.visibility === 'hidden' || +ps.opacity < 0.05) return false; }
    return true;
  };
  const shown = (el) => vis(el) || ((el.type === 'checkbox' || el.type === 'radio' || el.type === 'file') && (vis(el.closest('label')) || (el.id && vis(document.querySelector(`label[for="${CSS.escape(el.id)}"]`))) || vis(el.parentElement)));
  const txt = (el) => (el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  function labelOf(el) {
    const parts = [];
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) parts.push(txt(l)); }
    const wrap = el.closest('label'); if (wrap) parts.push(txt(wrap));
    if (el.getAttribute('aria-label')) parts.push(el.getAttribute('aria-label'));
    const lb = el.getAttribute('aria-labelledby'); if (lb) lb.split(/\s+/).forEach(id => { const n = document.getElementById(id); if (n) parts.push(txt(n)); });
    if (!parts.length) {
      for (let w = el.parentElement, i = 0; w && i < 3 && !parts.length; w = w.parentElement, i++) {
        const c = [...w.querySelectorAll('label,legend,span,p,div,strong,b')].filter(n => !n.contains(el) && (n.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) && /[a-z]/i.test(txt(n)) && txt(n).length < 80 && !n.querySelector('input,select,textarea'));
        if (c.length) parts.push(txt(c[c.length - 1]));
      }
    }
    return parts.join(' ').slice(0, 160);
  }
  const isField = (el) => el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !['hidden', 'submit', 'button', 'image', 'reset', 'password', 'search'].includes((el.type || 'text').toLowerCase()));
  const fieldsIn = (root) => [...root.querySelectorAll('input,textarea,select')].filter(isField);
  function score(root) {
    const f = fieldsIn(root).filter(shown); if (!f.length) return -99;
    let s = 0;
    if (f.some(e => e.tagName === 'TEXTAREA')) s += 6;
    if (f.some(e => e.type === 'email' || /mail/i.test(e.name + labelOf(e)))) s += 3;
    if (f.some(e => e.type === 'tel' || /phone/i.test(e.name + labelOf(e)))) s += 2;
    s += Math.min(4, f.filter(e => e.tagName === 'INPUT').length);
    if (root.querySelector && root.querySelector('input[type=password]')) s -= 30;
    if (root.getAttribute && (root.getAttribute('role') === 'search' || /search|newsletter|subscribe|login/i.test((root.className || '') + ' ' + (root.id || '') + ' ' + (root.action || '')))) s -= 15;
    if (f.length <= 2 && !f.some(e => e.tagName === 'TEXTAREA')) s -= 6;
    return s;
  }
  function findRoot() {
    const roots = [...document.querySelectorAll('form')];
    for (const ta of document.querySelectorAll('textarea')) { if (ta.closest('form')) continue; let p = ta.parentElement; while (p && p !== document.body && !p.querySelector('button,[role=button],input[type=submit]')) p = p.parentElement; if (p && !roots.includes(p)) roots.push(p); }
    let best = null, bs = 2;
    for (const r of roots) { const s = score(r); if (s > bs) { bs = s; best = r; } }
    return best;
  }

  /* ---------------------------------------------------------- classification and values (same rules as the robot) */
  const has = (re, f) => re.test(`${f.label} ${f.name} ${f.id} ${f.ph} ${f.ac}`);
  function classify(el, f) {
    const t = (el.type || '').toLowerCase();
    if (t === 'file') return 'file';
    if (t === 'checkbox') return has(/agree|consent|terms|privacy|policy|accept|authori[sz]|permission|opt.?in|acknowledg|gdpr|i understand|i confirm|sms|text messages|contact me/i, f) ? 'consent' : 'checkbox';
    if (t === 'radio') return 'radio';
    if (el.tagName === 'SELECT') return has(/state|province|region/i, f) ? 'state' : has(/country/i, f) ? 'country' : has(/hear|find us|referr|source/i, f) ? 'source' : 'select';
    if (t === 'range') return 'range';
    if (/^(date|datetime-local|month|week)$/.test(t)) return 'date';
    if (t === 'time') return 'time';
    if (has(/confirm|verify|re-?enter|repeat|again/i, f) && has(/mail/i, f)) return 'email';
    if (t === 'email' || has(/e-?mail/i, f)) return 'email';
    if (t === 'tel' || has(/phone|mobile|cell|\btel\b|telephone|contact number/i, f)) return 'phone';
    if (has(/first.?name|fname|given.?name|^first$|\bfirst\b/i, f)) return 'first';
    if (has(/last.?name|lname|surname|family.?name|^last$|\blast\b/i, f)) return 'last';
    if (t === 'url' || has(/website|\burl\b|web site|domain/i, f)) return 'website';
    if (has(/company|business|organi[sz]ation|firm|employer/i, f)) return 'company';
    if (has(/subject|topic|regarding|title|reason for/i, f) && el.tagName !== 'TEXTAREA') return 'subject';
    if (el.tagName === 'TEXTAREA' || has(/message|comment|question|details|describe|inquiry|enquiry|project|notes|how can we help|tell us|requirements|description/i, f)) return 'message';
    if (has(/zip|postal|post.?code/i, f)) return 'zip';
    if (has(/\bcity\b|town|suburb/i, f)) return 'city';
    if (has(/address|street/i, f)) return 'address';
    if (has(/full.?name|your.?name|\bname\b|contact.?person/i, f)) return 'name';
    if (t === 'number') return 'number';
    return 'text';
  }
  const digits = s => String(s || '').replace(/\D/g, '');
  function phoneFor(el, phone) {
    let d = digits(phone); if (d.length === 11 && d[0] === '1') d = d.slice(1);
    if (d.length !== 10) return phone;
    const a = d.slice(0, 3), b = d.slice(3, 6), c = d.slice(6);
    const opts = [`(${a}) ${b}-${c}`, `${a}-${b}-${c}`, d, `${a}.${b}.${c}`, `+1${d}`, `+1 ${a} ${b} ${c}`];
    const pat = el.getAttribute('pattern');
    if (pat) { try { const re = new RegExp(`^(?:${pat})$`); const m = opts.find(o => re.test(o)); if (m) return m; } catch { /* bad pattern */ } }
    const ph = el.getAttribute('placeholder') || '';
    if (/\(\d{3}\)/.test(ph)) return opts[0];
    if (/^\d{3}-\d{3}/.test(ph)) return opts[1];
    if (el.maxLength > 0 && el.maxLength <= 10) return d;
    return opts[0];
  }
  const nextBizDay = () => { const d = new Date(); d.setDate(d.getDate() + 2); while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1); return d; };
  const pad = (s, n) => { const x = [' Thank you for your time.', ' I look forward to hearing from you.', ' Have a great day.']; let i = 0; while (s.length < n) s += x[i++ % x.length]; return s; };
  function valueFor(el, cls, P) {
    const fit = (v) => { let s = String(v ?? ''); if (el.minLength > 0 && s.length < el.minLength) s = cls === 'message' ? pad(s, el.minLength) : s.padEnd(el.minLength, '.'); if (el.maxLength > 0 && s.length > el.maxLength) s = s.slice(0, el.maxLength); return s; };
    const url = /^https?:/.test(P.website || '') ? P.website : P.website && P.website !== 'N/A' ? `https://${P.website}` : `https://${(P.email || '').split('@')[1] || 'example.com'}`;
    switch (cls) {
      case 'first': return fit(P.firstName); case 'last': return fit(P.lastName); case 'name': return fit(`${P.firstName} ${P.lastName}`);
      case 'email': return fit(P.email); case 'phone': return fit(phoneFor(el, P.phone));
      case 'company': return fit(P.company); case 'website': return fit(el.type === 'url' || !P.website || P.website === 'N/A' ? url : P.website);
      case 'subject': return fit(P.subject); case 'message': return fit(P.message);
      case 'zip': return fit(P.zip); case 'city': return fit(P.city); case 'address': return fit(P.address);
      case 'date': { const d = nextBizDay(), iso = d.toISOString().slice(0, 10); return el.type === 'datetime-local' ? iso + 'T10:00' : el.type === 'month' ? iso.slice(0, 7) : iso; }
      case 'time': return el.min && el.min > '10:00' ? el.min : '10:00';
      case 'number': case 'range': { const min = el.min !== '' ? +el.min : null, max = el.max !== '' ? +el.max : null; let v = min !== null ? Math.max(min, 1) : 1; if (max !== null) v = Math.min(v, max); return String(v); }
      default: {
        const l = `${labelOf(el)} ${el.placeholder || ''}`.toLowerCase();
        if (/date|when/.test(l)) { const d = nextBizDay(); return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`; }
        if (/how many|number of|quantity/.test(l)) return '1';
        return fit('N/A');
      }
    }
  }
  const PLACEHOLDER = /^(select|choose|please|pick|--|—|-\s|none selected|\s*$|\.\.\.)/i;
  function pickOption(el, cls, P) {
    const real = [...el.options].filter(o => !o.disabled && o.value.trim() !== '' && !PLACEHOLDER.test(o.text.trim()));
    if (!real.length) return null;
    const by = (re) => real.find(o => re.test(o.text) || re.test(o.value));
    if (cls === 'state' && P.state) { const s = P.state.toLowerCase(); const m = real.find(o => o.value.toLowerCase() === s || o.text.toLowerCase() === s || (P.stateName && o.text.toLowerCase() === P.stateName.toLowerCase())); if (m) return m; }
    if (cls === 'country') { const m = by(/united states|^us$|^usa$/i); if (m) return m; }
    if (cls === 'source') { const m = by(/google|search|internet|online|web/i); if (m) return m; }
    return by(/general|other|inquiry|enquiry|question|quote|estimate|consult|information|contact/i) || real[Math.floor(Math.random() * real.length)];
  }

  // Set values the way a person typing would, so React/Vue forms see them.
  function setValue(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus({ preventScroll: true });
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }
  function check(el) { if (!el.checked) { el.click(); if (!el.checked) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); } } }
  const mark = (el) => { const t = el.type === 'checkbox' || el.type === 'radio' ? (el.closest('label') || el) : el; t.style.outline = '2px solid #1C8F58'; t.style.outlineOffset = '1px'; if (t === el && el.type !== 'file') t.style.backgroundColor = 'rgba(28,143,88,.07)'; };

  /* ---------------------------------------------------------- branded PDF for required uploads */
  function pdfFile(P) {
    const W = 612, H = 792, ascii = s => String(s || '').normalize('NFKD').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7E\n]/g, '');
    const esc = s => ascii(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const wrap = (s, n) => ascii(s).split('\n').flatMap(line => { const out = []; let cur = ''; for (const w of line.split(' ')) { if ((cur + ' ' + w).trim().length > n) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); } out.push(cur); return out; });
    const lines = [];
    const T = (font, size, x, y, s, rgb = '0.08 0.09 0.11') => lines.push(`BT ${rgb} rg /${font} ${size} Tf ${x} ${y} Td (${esc(s)}) Tj ET`);
    lines.push('0.98 0.976 0.965 rg 0 0 612 792 re f', '0.949 0.722 0.027 rg 72 712 26 4 re f');
    T('F2', 10, 72, 696, (P.company || '').toUpperCase());
    T('F1', 8, 72, 640, 'SUBJECT', '0.4 0.4 0.42');
    let y = 616; for (const l of wrap(P.subject, 34)) { T('F2', 24, 72, y, l); y -= 30; }
    lines.push(`0.949 0.722 0.027 rg 72 ${y - 2} 40 3 re f`); y -= 34;
    const size = P.message.length > 1600 ? 9 : 10.5, lh = size * 1.6;
    for (const l of wrap(P.message, size > 10 ? 88 : 100)) { if (y < 90) break; T('F1', size, 72, y, l); y -= lh; }
    lines.push('0.89 0.88 0.86 RG 0.5 w 72 64 m 540 64 l S');
    T('F1', 8, 72, 50, [P.website, P.phone, P.email].filter(Boolean).join('  |  '), '0.42 0.43 0.46');
    const content = lines.join('\n');
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
    let out = '%PDF-1.4\n'; const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const x = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
    const name = `${(P.company || 'introduction').toLowerCase().replace(/[^a-z0-9]+/g, '-')}${P.leadCompany ? '-for-' + P.leadCompany.toLowerCase().replace(/[^a-z0-9]+/g, '-') : ''}.pdf`.replace(/-+/g, '-');
    return new File([new TextEncoder().encode(out)], name, { type: 'application/pdf' });
  }

  /* ---------------------------------------------------------- fill */
  function fill(P) {
    const root = findRoot(); if (!root) return { count: 0, root: null, skipped: [] };
    let count = 0; const skipped = [], radios = new Set(), groups = {};
    for (const el of fieldsIn(root)) {
      if (el.disabled || el.readOnly || !shown(el)) continue;
      const f = { label: labelOf(el), name: el.name || '', id: el.id || '', ph: el.getAttribute('placeholder') || '', ac: el.getAttribute('autocomplete') || '' };
      if (/honey|hpot|^hp[_-]|leave.*(blank|empty)|do not fill/i.test(f.name + ' ' + f.label)) continue;
      const cls = classify(el, f);
      const req = el.required || el.getAttribute('aria-required') === 'true' || /\*/.test(f.label);
      try {
        if (cls === 'file') {
          if (!req && !el.closest('form')?.querySelector('input[type=file][required]')) continue;
          if (/image/.test(el.accept || '') && !/pdf/.test(el.accept || '')) { skipped.push('an image upload (attach one yourself)'); continue; }
          if (/\.docx?|msword/.test(el.accept || '') && !/pdf/.test(el.accept)) { skipped.push('a Word file upload'); continue; }
          const dt = new DataTransfer(); dt.items.add(pdfFile(P)); el.files = dt.files; el.dispatchEvent(new Event('change', { bubbles: true })); mark(el); count++; continue;
        }
        if (cls === 'radio') { if (el.name) { (groups[el.name] ||= []).push(el); radios.add(el.name); } continue; }
        if (cls === 'checkbox' || cls === 'consent') { if (cls === 'consent' || req) { check(el); mark(el); count++; } else if (el.name) (groups['cb:' + el.name] ||= []).push(el); continue; }
        if (el.tagName === 'SELECT') { if (el.value && !PLACEHOLDER.test(el.options[el.selectedIndex]?.text || '')) continue; const o = pickOption(el, cls, P); if (o) { setValue(el, o.value); mark(el); count++; } continue; }
        if (el.value && el.value.trim()) continue; // leave anything already typed
        const v = valueFor(el, cls, P);
        if (!v || /undefined/.test(v)) { skipped.push(f.label || f.name); continue; }
        setValue(el, v); mark(el); count++;
      } catch { skipped.push(f.label || f.name); }
    }
    for (const name of radios) {
      const items = groups[name]; if (items.some(r => r.checked)) continue;
      const text = r => (r.closest('label') ? txt(r.closest('label')) : r.value);
      const pick = items.find(r => /email|general|other|inquiry|quote|no preference|any|yes/i.test(text(r))) || items[0];
      check(pick); mark(pick); count++;
    }
    for (const [k, items] of Object.entries(groups)) {
      if (!k.startsWith('cb:') || items.length < 2 || items.some(i => i.checked)) continue;
      const legend = txt(items[0].closest('fieldset')?.querySelector('legend'));
      if (/\*|required|at least/i.test(legend)) { const it = items.find(i => !/none|n\/a/i.test(txt(i.closest('label')))) || items[0]; check(it); mark(it); count++; }
    }
    if (root.querySelector('[role="combobox"],[aria-haspopup="listbox"]')) skipped.push('a custom dropdown');
    return { count, root, skipped };
  }

  /* ---------------------------------------------------------- panel and send detection */
  let panel = null;
  function showPanel(html) {
    if (!TOP) return;
    if (!panel) {
      panel = document.createElement('div');
      panel.attachShadow({ mode: 'open' });
      panel.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647';
      document.documentElement.appendChild(panel);
    }
    panel.shadowRoot.innerHTML = `<style>
      .p{font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#14161b;background:#fff;border:1px solid #e3e5ea;border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,.18);padding:14px 16px;width:300px}
      .h{display:flex;align-items:center;gap:8px;font-weight:650;margin-bottom:6px}.h i{width:22px;height:22px;border-radius:6px;background:#EE6420;display:grid;place-items:center;color:#fff;font-style:normal;font-size:12px}
      .x{margin-left:auto;border:0;background:none;font-size:16px;cursor:pointer;color:#8b919d}
      p{margin:0 0 10px;color:#5f6674}.r{display:flex;gap:6px;flex-wrap:wrap}
      button.b{border:1px solid #e3e5ea;background:#fff;border-radius:8px;padding:6px 10px;font:inherit;font-weight:550;cursor:pointer}
      button.pr{background:#EE6420;border-color:#EE6420;color:#fff}.ok{color:#1C8F58;font-weight:600}.bad{color:#CF3F37}</style>
      <div class="p"><div class="h"><i>LH</i>LeadsHunter<button class="x" data-a="close" aria-label="Close">×</button></div>${html}</div>`;
    panel.shadowRoot.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => actions[b.dataset.a] && actions[b.dataset.a]()));
  }
  let CUR = null;
  const actions = {
    close: () => { panel && panel.remove(); panel = null; },
    refill: () => run(CUR, true),
    captcha: () => { const c = document.querySelector(CAPTCHA); if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); c.style.outline = '3px solid #7A4FE0'; c.style.outlineOffset = '4px'; } },
    sent: () => report(CUR, 'Marked sent from the extension'),
  };
  async function report(P, evidence) {
    const r = await send({ type: 'markSent', api: P.api, oid: P.oid, token: P.token, evidence });
    if (r && r.ok) { await send({ type: 'clearPending' }); showPanel(`<p class="ok">✓ Marked as sent in LeadsHunter.</p><p>${evidence ? evidence.replace(/</g, '&lt;') : ''}</p>`); }
    else showPanel(`<p class="bad">${(r && r.error) || 'Could not update LeadsHunter.'}</p><div class="r"><button class="b" data-a="sent">Try again</button></div>`);
  }
  function watchForSuccess(P) {
    const before = (document.body.innerText.match(new RegExp(SUCCESS.source, 'gi')) || []).length;
    const onSubmit = () => send({ type: 'setPending', pending: { api: P.api, oid: P.oid, token: P.token, before } });
    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('click', (e) => { if (e.target.closest('button,[type=submit],[role=button]')) onSubmit(); }, true);
    const iv = setInterval(async () => {
      const now = (document.body.innerText.match(new RegExp(SUCCESS.source, 'gi')) || []).length;
      if (now > before && await send({ type: 'getPending' })) { clearInterval(iv); const line = document.body.innerText.split('\n').find(l => SUCCESS.test(l)) || ''; report(P, line.trim().slice(0, 160)); }
    }, 1000);
    setTimeout(() => clearInterval(iv), 10 * 60e3);
  }
  function run(P, again) {
    CUR = P;
    const r = fill(P);
    const cap = !!document.querySelector(CAPTCHA);
    if (!TOP) return;
    if (!r.root && !again) {
      showPanel(`<p>No contact form on this page yet. Open the contact page, then press Fill.</p><div class="r"><button class="b pr" data-a="refill">Fill</button><button class="b" data-a="sent">I sent it</button></div>`);
      return;
    }
    showPanel(`<p><b>${r.count} field${r.count === 1 ? '' : 's'} filled</b> (outlined in green). ${cap ? 'Solve the CAPTCHA, then press the form’s send button.' : 'Check them, then press the form’s send button.'}</p>
      ${r.skipped.length ? `<p class="bad">Fill yourself: ${[...new Set(r.skipped)].join(', ')}.</p>` : ''}
      <p>It’s marked sent here automatically when the site confirms.</p>
      <div class="r">${cap ? '<button class="b pr" data-a="captcha">Go to CAPTCHA</button>' : ''}<button class="b" data-a="refill">Fill again</button><button class="b" data-a="sent">I sent it</button></div>`);
    if (!again) { watchForSuccess(P); if (cap) setTimeout(actions.captcha, 400); }
  }

  /* ---------------------------------------------------------- start */
  (async () => {
    if (TOP) {
      const fromHash = readHash();
      if (fromHash) { await send({ type: 'setPayload', payload: fromHash }); setTimeout(() => run(fromHash), 600); return; }
      // Came back on a thank-you page after submitting?
      const pend = await send({ type: 'getPending' });
      if (pend) {
        const hit = /thank|success|confirm|sent|received|complete/i.test(location.pathname) || SUCCESS.test(document.body.innerText);
        if (hit) { CUR = pend; const line = document.body.innerText.split('\n').find(l => SUCCESS.test(l)) || `Redirected to ${location.pathname}`; report(pend, line.trim().slice(0, 160)); }
        return;
      }
      const p = await send({ type: 'getPayload' });
      if (p) setTimeout(() => run(p, false), 600); // same tab, next page of the site (for example the contact page)
    } else {
      const p = await send({ type: 'getPayload' });
      if (p) setTimeout(() => fill(p), 900);
    }
  })();
})();
