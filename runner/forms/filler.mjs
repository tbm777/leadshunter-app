// LeadsHunter form engine: find the contact form, give every field a valid value, submit, and prove the result.
// Works on a Playwright Page. Never bypasses CAPTCHAs: those are reported as manual.
import { brandedFile } from './files.mjs';
import { captchaInPage, usableFrames, evalIn } from './captcha-probe.mjs';
import { personalize, cleanCompanyName } from './personalize.mjs';

const SUCCESS = /(thank\s?(you|s)\b|message (has been |was )?(sent|received|delivered)|we('ll| will) (be in touch|get back|contact you|respond|reach out)|successfully (sent|submitted)|submission (received|successful)|request (has been |was )?(received|sent|submitted)|we (have|'ve) received|form (has been |was )?submitted|thanks for (reaching|contacting|getting)|your (message|inquiry|enquiry|request) (has been|was) )/i;
const SUBMIT_TEXT = /^(send|submit|send message|send now|submit (form|request|message|inquiry)|request|get (a |my |your )?(free )?(quote|estimate)|request (a )?(quote|estimate|call|callback|appointment|service)|contact( us)?|book( now)?|schedule|get started|send request|let'?s talk|go)\b/i;
const NEXT_TEXT = /^(next|continue|proceed|next step|go to step|forward)\b/i;
const CAPTCHA_SEL = 'iframe[src*="recaptcha"],.g-recaptcha,iframe[src*="hcaptcha"],.h-captcha,iframe[src*="challenges.cloudflare.com"],.cf-turnstile,[data-sitekey],iframe[src*="friendlycaptcha"],.frc-captcha';

/* ------------------------------------------------------------------ in-page scanner */
// Runs inside the page/frame. Picks the best contact container and tags its fields with data-lh ids.
function scanInPage(prevMax) {
  const vis = (el) => {
    if (!el || !el.isConnected) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.right < -100 || r.bottom < -100 || r.left > innerWidth + 2000) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    let p = el.parentElement;
    while (p && p !== document.body) { const ps = getComputedStyle(p); if (ps.display === 'none' || ps.visibility === 'hidden' || +ps.opacity < 0.05) return false; if (ps.overflow === 'hidden' && p.getBoundingClientRect().height < 2) return false; p = p.parentElement; }
    return true;
  };
  const txt = (el) => (el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const labelOf = (el) => {
    const parts = [];
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) parts.push(txt(l)); }
    const wrap = el.closest('label'); if (wrap) parts.push(txt(wrap));
    if (el.getAttribute('aria-label')) parts.push(el.getAttribute('aria-label'));
    const lb = el.getAttribute('aria-labelledby'); if (lb) lb.split(/\s+/).forEach(id => { const n = document.getElementById(id); if (n) parts.push(txt(n)); });
    if (!parts.length && !el.getAttribute('placeholder')) {
      // nearest preceding text inside the field's wrapper (fieldset legend, div label, p), never outside the form
      const stop = el.closest('form');
      let w = el.parentElement, hops = 0;
      while (w && hops < 3 && !parts.length && w !== (stop && stop.parentElement)) {
        const cand = [...w.querySelectorAll('label,legend,.label,span,p,div,strong,b')].filter(n => !n.contains(el) && n.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING && /[a-z]/i.test(txt(n)) && txt(n).length < 80 && !n.querySelector('input,select,textarea'));
        if (cand.length) { let c = cand[cand.length - 1]; while (c.parentElement && cand.includes(c.parentElement)) c = c.parentElement; parts.push(txt(c)); }
        w = w.parentElement; hops++;
      }
    }
    return parts.join(' ').slice(0, 160);
  };
  const isField = (el) => {
    const t = el.tagName;
    if (t === 'TEXTAREA' || t === 'SELECT') return true;
    if (t === 'INPUT') return !['hidden', 'submit', 'button', 'image', 'reset'].includes((el.type || 'text').toLowerCase());
    if (el.isContentEditable && el.getAttribute('contenteditable') !== 'false' && !el.parentElement?.isContentEditable) return true;
    const role = el.getAttribute('role');
    return role === 'combobox' || (role === 'button' && el.getAttribute('aria-haspopup') === 'listbox') || el.hasAttribute('data-lh-select');
  };
  const fieldsIn = (root) => [...root.querySelectorAll('input,textarea,select,[contenteditable],[role="combobox"],[role="button"][aria-haspopup="listbox"],[data-lh-select]')].filter(isField);
  const scoreRoot = (root) => {
    const f = fieldsIn(root).filter(e => vis(e) || ((e.type === 'checkbox' || e.type === 'radio') && e.closest('label') && vis(e.closest('label'))));
    if (!f.length) return -99;
    let s = 0;
    const text = f.filter(e => e.tagName === 'INPUT' && /text|email|tel|url|^$/.test(e.type || 'text'));
    if (f.some(e => e.tagName === 'TEXTAREA' || e.isContentEditable)) s += 6;
    if (f.some(e => e.type === 'email' || /mail/i.test(e.name + labelOf(e)))) s += 3;
    if (f.some(e => e.type === 'tel' || /phone/i.test(e.name + labelOf(e)))) s += 2;
    s += Math.min(4, text.length);
    if (root.getAttribute && (root.getAttribute('role') === 'search' || /search/i.test(root.className + ' ' + (root.action || '')))) s -= 20;
    if (f.length === 1 && /search|^s$|^q$/i.test(f[0].name || f[0].type)) s -= 20;
    if (f.length <= 2 && !f.some(e => e.tagName === 'TEXTAREA') && f.some(e => e.type === 'email') && !f.some(e => /name/i.test(e.name + labelOf(e)))) s -= 8; // newsletter
    if (/newsletter|subscribe|login|sign.?in|password/i.test((root.className || '') + ' ' + (root.id || '') + ' ' + (root.action || ''))) s -= 10;
    if (f.some(e => e.type === 'password')) s -= 30;
    // A contact form always has somewhere to write a message (possibly on a later step). Without one it's a signup, login or newsletter form.
    const all = fieldsIn(root);
    if (!all.some(e => e.tagName === 'TEXTAREA' || e.isContentEditable || /message|comment|question|details|inquiry|enquiry|describe|project|how can we help|tell us/i.test(`${e.name} ${labelOf(e)} ${e.getAttribute('placeholder') || ''}`))) return -50;
    const btns = [...root.querySelectorAll('button,input[type="submit"],[role="button"]')].map(b => txt(b) || b.value || '').join(' | ');
    if (/sign ?up|create (an |your )?account|\bregister\b|join (now|free|us|today)|log ?in|sign ?in|subscribe|get the app|download the app/i.test(btns)) s -= 25;
    if (all.some(e => /user.?name|confirm.?password|create.?password|new.?password/i.test(`${e.name} ${labelOf(e)}`))) s -= 25;
    return s;
  };
  let roots = [...document.querySelectorAll('form')];
  // Containers without <form>: the closest ancestor of a textarea that also holds a button.
  for (const ta of document.querySelectorAll('textarea,[contenteditable="true"]')) {
    if (ta.closest('form')) continue;
    let p = ta.parentElement;
    while (p && p !== document.body && !p.querySelector('button,[role="button"],input[type="submit"]')) p = p.parentElement;
    if (p && !roots.includes(p)) roots.push(p);
  }
  let best = null, bestScore = -99;
  const kept = document.querySelector('[data-lh-root]');
  if (kept) { best = kept; bestScore = Math.max(3, scoreRoot(kept)); } // stay on the chosen form across wizard steps
  else for (const r of roots) { const sc = scoreRoot(r); if (sc > bestScore) { bestScore = sc; best = r; } }
  if (!best || bestScore < 3) return { found: false, login: !!document.querySelector('input[type="password"]') };
  best.setAttribute('data-lh-root', '1');
  window.__lhDoc = window.__lhDoc || Math.random(); // marks this document, so a reloaded page is never mistaken for a closed form
  const page = document.body.innerText || '';
  // Only a challenge a person must solve counts; invisible score checks (badge only) are sent normally.
  const probe = window.__lhProbe ? window.__lhProbe() : { kind: null, type: null };
  const captcha = probe.kind === 'visible', captchaType = probe.type;
  let n = prevMax;
  const fields = [];
  for (const el of fieldsIn(best)) {
    const type = (el.tagName === 'INPUT' ? (el.type || 'text') : el.tagName.toLowerCase()).toLowerCase();
    const isChoice = type === 'checkbox' || type === 'radio';
    const label = labelOf(el);
    const visible = vis(el) || (isChoice && el.closest('label') && vis(el.closest('label'))) || (isChoice && el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`) && vis(document.querySelector(`label[for="${CSS.escape(el.id)}"]`))) || (type === 'file' && el.closest('label,div') && vis(el.closest('label,div')));
    const nm = (el.name || el.id || '');
    // Spam traps: honeypot names, or inputs hidden from screen readers and skipped by Tab (WPForms, Gravity Forms…). Filling one gets the message thrown away.
    const trap = /honey|hpot|^hp[_-]?|ohnohoney|leave.*(blank|empty)|do not fill|bot.?check|^url2$|^website2$|^fax_only$|^confirm_url$/i.test(nm + ' ' + label) || (el.tabIndex === -1 && !isChoice && el.getAttribute('autocomplete') === 'off' && !vis(el)) || (!isChoice && el.getAttribute('aria-hidden') === 'true' && el.tabIndex === -1) || !!el.closest('[aria-hidden="true"][tabindex="-1"]');
    if (!el.hasAttribute('data-lh')) el.setAttribute('data-lh', String(++n));
    const req = el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$|\*\s|required/i.test(label) || /required/i.test(el.className || '');
    const opts = el.tagName === 'SELECT' ? [...el.options].map(o => ({ value: o.value, text: o.text.trim(), disabled: o.disabled })) : [];
    let group = null;
    if (isChoice && el.name) group = el.name;
    // Labels for radio/checkbox groups: the group's legend or heading, plus the option's own label.
    let groupLabel = '';
    if (isChoice) {
      const fs = el.closest('fieldset'); if (fs && fs.querySelector('legend')) groupLabel = txt(fs.querySelector('legend'));
      if (!groupLabel) { let w = el.parentElement, hops = 0; while (w && hops < 4) { if (w.querySelectorAll(`input[name="${CSS.escape(el.name || '')}"]`).length > 1) { const h = [...w.querySelectorAll('label,legend,p,span,div,strong')].find(x => !x.querySelector('input') && txt(x).length < 90 && txt(x).length); if (h) groupLabel = txt(h); break; } w = w.parentElement; hops++; } }
    }
    fields.push({
      id: el.getAttribute('data-lh'), tag: el.tagName.toLowerCase(), type, name: el.name || '', elId: el.id || '', label, groupLabel, placeholder: el.getAttribute('placeholder') || '',
      required: !!req, visible: !!visible, trap: !!trap && !visible ? true : !!trap, disabled: !!el.disabled, readonly: !!el.readOnly,
      options: opts, group, checked: !!el.checked, value: el.value ?? '', ownText: isChoice ? txt(el.closest('label')) || (el.id && txt(document.querySelector(`label[for="${CSS.escape(el.id)}"]`))) || el.value : '',
      min: el.getAttribute('min'), max: el.getAttribute('max'), step: el.getAttribute('step'), minLength: el.minLength > 0 ? el.minLength : null, maxLength: el.maxLength > 0 ? el.maxLength : null,
      pattern: el.getAttribute('pattern'), accept: el.getAttribute('accept') || '', multiple: !!el.multiple, autocomplete: el.getAttribute('autocomplete') || '',
      role: el.getAttribute('role') || '', contentEditable: !!el.isContentEditable,
    });
  }
  const buttons = [...best.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"],a.button,a.btn')].filter(vis).map(b => {
    if (!b.hasAttribute('data-lh-btn')) b.setAttribute('data-lh-btn', String(++n));
    return { id: b.getAttribute('data-lh-btn'), text: (txt(b) || b.value || b.getAttribute('aria-label') || '').slice(0, 60), type: (b.getAttribute('type') || (b.tagName === 'BUTTON' ? 'submit' : '')).toLowerCase(), tag: b.tagName.toLowerCase() };
  });
  return { found: true, score: bestScore, captcha, captchaType, fields, buttons, maxId: n, isForm: best.tagName === 'FORM', textLen: page.length };
}

/* ------------------------------------------------------------------ classification and values */
const has = (re, f) => re.test(`${f.label} ${f.groupLabel} ${f.name} ${f.elId} ${f.placeholder} ${f.autocomplete}`);
export function classify(f) {
  const t = f.type;
  if (t === 'file') return 'file';
  if (t === 'checkbox') return has(/agree|consent|terms|privacy|policy|accept|authori[sz]|permission|opt.?in|acknowledg|gdpr|i understand|i confirm|sms|text messages|contact me|not a robot/i, f) ? 'consent' : 'checkbox';
  if (t === 'radio') return 'radio';
  if (f.tag === 'select' || f.role === 'combobox' || f.role === 'button') {
    if (has(/state|province|region/i, f)) return 'state';
    if (has(/country/i, f)) return 'country';
    return 'select';
  }
  if (t === 'range') return 'range';
  if (t === 'date' || t === 'datetime-local' || t === 'month' || t === 'week') return 'date';
  if (t === 'time') return 'time';
  if (t === 'color') return 'color';
  if (has(/confirm|verify|re-?enter|repeat|again/i, f) && has(/mail/i, f)) return 'confirm_email';
  if (t === 'email' || has(/e-?mail/i, f)) return 'email';
  if (t === 'tel' || has(/phone|mobile|cell|\btel\b|telephone|contact number/i, f)) return 'phone';
  if (has(/first.?name|fname|given.?name|^first$|\bfirst\b/i, f)) return 'first';
  if (has(/last.?name|lname|surname|family.?name|^last$|\blast\b/i, f)) return 'last';
  if (t === 'url' || has(/website|\burl\b|web site|domain/i, f)) return 'website';
  if (has(/company|business|organi[sz]ation|firm|employer/i, f) && !has(/name of your (home|house)/i, f)) return 'company';
  if (has(/subject|topic|regarding|title|reason for/i, f) && f.tag !== 'textarea') return 'subject';
  if (f.tag === 'textarea' || f.contentEditable || has(/message|comment|question|details|describe|inquiry|enquiry|project|notes|how can we help|tell us|requirements|description/i, f)) return 'message';
  if (has(/zip|postal|post.?code/i, f)) return 'zip';
  if (has(/\bcity\b|town|suburb/i, f)) return 'city';
  if (has(/address|street/i, f)) return 'address';
  if (has(/full.?name|your.?name|\bname\b|contact.?person/i, f)) return 'name';
  if (t === 'number') return 'number';
  if (has(/budget|price|cost|amount/i, f)) return 'budget';
  if (has(/hear|find us|referr|source/i, f)) return 'source';
  return 'text';
}

const PLACEHOLDER_OPT = /^(select|choose|please|pick|--|—|-\s|none selected|\s*$|click|tap|\.\.\.)/i;
const PREFER = {
  select: /general|other|inquiry|enquiry|question|quote|estimate|consult|information|info|contact/i,
  source: /google|search|internet|online|web/i,
  radio: /email|e-mail|general|other|inquiry|quote|no preference|any|yes/i,
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function chooseOption(f, cls, options, profile) {
  const real = options.filter(o => !o.disabled && String(o.value).trim() !== '' && !PLACEHOLDER_OPT.test(o.text));
  if (!real.length) return options.find(o => !o.disabled && o.value !== '') || null;
  if (cls === 'state' && profile.state) { const s = profile.state.toLowerCase(); const m = real.find(o => o.value.toLowerCase() === s || o.text.toLowerCase() === s || (profile.stateName && o.text.toLowerCase() === profile.stateName.toLowerCase())); if (m) return m; }
  if (cls === 'country') { const m = real.find(o => /united states|^us$|^usa$/i.test(o.text) || /^us$/i.test(o.value)) || real.find(o => (profile.country || '').toLowerCase() === o.text.toLowerCase()); if (m) return m; }
  const pref = has(/hear|find us|referr|source/i, f) ? PREFER.source : PREFER.select;
  const preferred = real.filter(o => pref.test(o.text));
  return preferred.length ? preferred[0] : pick(real);
}
// A usable URL for website fields, even when the profile has none.
const urlOf = (p) => { const w = String(p.website || '').trim(); return !w || w === 'N/A' ? (p.email && p.email.includes('@') ? `https://${p.email.split('@')[1]}` : 'https://example.com') : /^https?:\/\//i.test(w) ? w : `https://${w}`; };
const digitsOf = s => String(s || '').replace(/\D/g, '');
function phoneVariants(phone) {
  let d = digitsOf(phone); if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return [phone, d];
  const a = d.slice(0, 3), b = d.slice(3, 6), c = d.slice(6);
  return [`(${a}) ${b}-${c}`, `${a}-${b}-${c}`, d, `${a}.${b}.${c}`, `${a} ${b} ${c}`, `+1${d}`, `+1 ${a} ${b} ${c}`, `+1 (${a}) ${b}-${c}`, `1${d}`, `(${a})${b}-${c}`];
}
// Put our digits into the shape of an example like 555-555-5555 or (555) 555 5555.
function mirrorFormat(example, phone) { let d = digitsOf(phone); const need = (example.match(/\d/g) || []).length; if (d.length > need) d = d.slice(-need); let i = 0; return example.replace(/\d/g, () => d[i++] ?? '0'); }
const nextBusinessDay = (min) => { const d = new Date(); d.setDate(d.getDate() + 2); while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1); if (min && new Date(min) > d) return new Date(min); return d; };
const iso = d => d.toISOString().slice(0, 10);
function fitPattern(pattern, candidates) {
  if (!pattern) return candidates[0];
  let re; try { re = new RegExp(`^(?:${pattern})$`, 'v'); } catch { try { re = new RegExp(`^(?:${pattern})$`); } catch { return candidates[0]; } }
  return candidates.find(c => re.test(String(c))) ?? null;
}
function genFromPattern(pattern) {
  // Simple generator for common patterns: digits, letters, fixed lengths.
  const m = pattern.match(/^\\d\{(\d+)(?:,(\d+))?\}$|^\[0-9\]\{(\d+)(?:,(\d+))?\}$/);
  if (m) return '1'.repeat(+(m[1] || m[3]));
  if (/^\[A-Za-z\s?\]/.test(pattern)) return 'Info';
  return null;
}
const pad = (s, n) => { let out = s; const extra = [' Thank you for your time.', ' I look forward to hearing from you.', ' Please let me know a good time to talk.', ' Have a great day.']; let i = 0; while (out.length < n) out += extra[i++ % extra.length]; return out; };

export function valueFor(f, cls, profile) {
  const fit = (v) => { let s = String(v ?? ''); if (f.minLength && s.length < f.minLength) s = cls === 'message' ? pad(s, f.minLength) : s.padEnd(f.minLength, '.'); if (f.maxLength && s.length > f.maxLength) s = s.slice(0, f.maxLength); return s; };
  switch (cls) {
    case 'first': return fit(profile.firstName);
    case 'last': return fit(profile.lastName);
    case 'name': return fit(`${profile.firstName} ${profile.lastName}`);
    case 'email': case 'confirm_email': return fit(profile.email);
    case 'company': return fit(profile.company || `${profile.firstName} ${profile.lastName}`);
    case 'website': return fit(f.type === 'url' || /http/i.test(f.placeholder) || !profile.website || profile.website === 'N/A' ? urlOf(profile) : profile.website);
    case 'subject': return fit(profile.subject);
    case 'message': return fit(profile.message);
    case 'phone': { if (f.type === 'number') { const d = digitsOf(profile.phone); return d.length === 11 && d[0] === '1' ? d.slice(1) : d; } const v = phoneVariants(profile.phone); const byPh = /\(\d{3}\)/.test(f.placeholder) ? v[0] : /^\d{3}-\d{3}/.test(f.placeholder) ? v[1] : /^\d{10}$/.test(f.placeholder.replace(/\D/g, '')) && !/\D/.test(f.placeholder) ? v[2] : null; const pv = fitPattern(f.pattern, v); const pick1 = f.pattern ? pv : byPh || (f.maxLength && f.maxLength <= 10 ? v[2] : v[0]); return fit(pick1 ?? v[2]); }
    case 'zip': { const z = profile.zip || '78701'; return fit(fitPattern(f.pattern, [z, z.slice(0, 5), z.replace(/\s/g, '')]) ?? z); }
    case 'city': return fit(profile.city || 'Austin');
    case 'address': return fit(profile.address || '100 Main St');
    case 'number': case 'budget': {
      const min = f.min !== null && f.min !== '' ? +f.min : null, max = f.max !== null && f.max !== '' ? +f.max : null, step = f.step && f.step !== 'any' ? +f.step : 1;
      let v = cls === 'budget' && min !== null && max !== null ? (min + max) / 2 : min !== null ? Math.max(min, 1) : 1;
      if (max !== null) v = Math.min(v, max);
      if (step && min !== null) v = min + Math.round((v - min) / step) * step; else if (step) v = Math.round(v / step) * step || step;
      if (cls === 'budget' && f.type !== 'number' && !f.min) return fit(profile.budget || '5000');
      return String(v);
    }
    case 'date': { const d = nextBusinessDay(f.min); if (f.max && d > new Date(f.max)) return f.max; if (f.type === 'date') return iso(d); if (f.type === 'datetime-local') return iso(d) + 'T10:00'; if (f.type === 'month') return iso(d).slice(0, 7); return fit(`${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`); }
    case 'time': return f.min && f.min > '10:00' ? f.min : '10:00';
    case 'color': return '#336699';
    case 'source': return fit('Online search');
    default: {
      const cands = ['N/A', 'None', 'Other', '1', 'Yes', profile.company || 'Info', profile.city || 'Austin'];
      const lbl = `${f.label} ${f.placeholder}`.toLowerCase();
      if (/ready to start|timeline|time ?frame|how soon|start date|when (would|do|are|can) you/.test(lbl) && !f.pattern) return fit('As soon as possible');
      if (/date|when/.test(lbl)) return valueFor({ ...f, type: 'text' }, 'date', profile);
      if (/how many|number of|\bqty\b|quantity|square f|sq\.? ?ft/.test(lbl)) return fit(fitPattern(f.pattern, ['1', '10', '100']) ?? '1');
      if (f.pattern) return fit(fitPattern(f.pattern, cands) ?? genFromPattern(f.pattern) ?? 'N/A');
      return fit(f.minLength && f.minLength > 3 ? 'No additional details' : 'N/A');
    }
  }
}

/* ------------------------------------------------------------------ the engine */
/** Which form tool the page uses (for accuracy stats by tool). Runs in the page. */
export function detectFormTool() {
  const h = document.documentElement.innerHTML.slice(0, 400000);
  const has = (re) => re.test(h);
  if (has(/wpforms/i)) return 'wpforms';
  if (has(/gform_wrapper|gravityforms/i)) return 'gravity';
  if (has(/wpcf7/i)) return 'cf7';
  if (has(/elementor-form/i)) return 'elementor';
  if (has(/ninja-forms|nf-form/i)) return 'ninja';
  if (has(/frm_form|formidable/i)) return 'formidable';
  if (has(/hsforms|hs-form|hbspt\.forms/i)) return 'hubspot';
  if (has(/jotform/i)) return 'jotform';
  if (has(/formspree/i)) return 'formspree';
  if (has(/static\.wixstatic|wix-forms|_wixCssImports|wixapps/i)) return 'wix';
  if (has(/squarespace/i)) return 'squarespace';
  if (has(/godaddy|wsimg\.com/i)) return 'godaddy';
  if (has(/typeform/i)) return 'typeform';
  if (has(/wp-content|wp-includes/i)) return 'wordpress-other';
  return 'other';
}

export async function submitForm(page, url, profile, opts = {}) {
  // Fill merge tags like [Company Name] from the lead (also used inside the uploaded file).
  if (opts.lead) profile = { ...profile, subject: personalize(profile.subject, opts.lead), message: personalize(profile.message, opts.lead), leadCompany: cleanCompanyName(opts.lead.name) };
  const log = [];
  const T0 = Date.now(); const note = (m) => { log.push(m); if (opts.debug) console.log('   ·', ((Date.now() - T0) / 1000).toFixed(1) + 's', m); };
  const timeout = opts.timeout || 25000;
  page.setDefaultTimeout(opts.actionTimeout || 5000);
  const mk = (k) => { if (opts.marks) opts.marks[k] = Date.now(); };
  mk('start');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  mk('dom');
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  mk('loaded');

  // Find the best contact container across the page and its frames.
  let frame = null, scan = null, maxId = 0, login = false;
  const rescan = async () => {
    for (const fr of usableFrames(page)) {
      try {
        await evalIn(fr, (sel) => { window.__LH_CAPTCHA = sel; }, CAPTCHA_SEL);
        await evalIn(fr, `window.__lhProbe = ${captchaInPage.toString()}`);
        const s = await evalIn(fr, scanInPage, maxId, 6000);
        if (s.found && (!scan || s.score > scan.score || fr === frame)) { scan = s; frame = fr; }
        if (!s.found && s.login) login = true;
      } catch { /* cross-origin or detached frame */ }
    }
  };
  await rescan();
  mk('scanned');
  if (opts.marks) opts.marks.tool = await page.evaluate(detectFormTool).catch(() => null);
  if (!scan) return login ? { status: 'manual', reason: 'login-required', log } : { status: 'failed', reason: 'no-form', log };
  if (scan.captcha) return { status: 'manual', reason: 'captcha', captcha: scan.captchaType || 'reCAPTCHA', log };
  maxId = scan.maxId;

  const filled = new Map();      // field id -> value we set
  const answers = new Map();     // what the robot answered beyond the profile and message, shown in the app
  const PROFILE_CLS = new Set(['first', 'last', 'name', 'email', 'confirm_email', 'phone', 'subject', 'message']);
  const answersText = () => [...answers].map(([k, v]) => `${k}: ${v}`).join(' · ').slice(0, 600);
  const before = await page.evaluate(() => document.body.innerText).catch(() => '');
  const startUrl = page.url();

  const loc = (id) => frame.locator(`[data-lh="${id}"]`);
  const fillField = async (f, override) => {
    if (f.disabled || f.readonly || !f.visible || f.trap) return;
    const cls = classify(f);
    const el = loc(f.id);
    try {
      if (cls === 'file') {
        if (!f.required && !opts.alwaysUpload) return;
        const file = await brandedFile(page.context(), f.accept, profile);
        if (!file) throw new Error('unsupported-file-type');
        await el.setInputFiles(file); filled.set(f.id, file.name); answers.set('File attached', file.name); note(`file → ${file.name}`); return;
      }
      if (f.tag === 'select') {
        const o = override ? f.options.find(x => x.value === override || x.text === override) : chooseOption(f, cls, f.options, profile);
        if (!o) return;
        await el.selectOption(o.value); filled.set(f.id, o.text); answers.set(String(f.label || f.placeholder || f.name || cls).replace(/\s*\*\s*/g, ' ').trim().slice(0, 60), o.text); note(`${f.label || f.name} → ${o.text}`); return;
      }
      if (f.role === 'combobox' || f.role === 'button' || f.tag === 'div' || f.tag === 'span' || f.tag === 'button') {
        if (f.contentEditable) { await el.click(); await el.fill(override ?? valueFor(f, cls, profile)); filled.set(f.id, 'text'); return; }
        await el.click();
        const optLoc = frame.locator('[role="option"]:visible, [data-lh-option]:visible, li[data-value]:visible');
        await optLoc.first().waitFor({ timeout: 3000 });
        const texts = await optLoc.allInnerTexts();
        const cands = texts.map((t, i) => ({ value: String(i), text: t.trim(), disabled: false }));
        const o = chooseOption(f, cls, cands, profile);
        await optLoc.nth(+o.value).click(); filled.set(f.id, o.text); answers.set(String(f.label || f.placeholder || f.name || cls).replace(/\s*\*\s*/g, ' ').trim().slice(0, 60), o.text); note(`${f.label || f.name} → ${o.text} (custom dropdown)`); return;
      }
      if (f.type === 'checkbox') {
        if (cls === 'consent' || f.required || override === 'check') { if (!(await el.isChecked())) await el.check({ force: true }); filled.set(f.id, 'checked'); answers.set(String(f.ownText || f.label || 'Checkbox').replace(/\s*\*\s*/g, ' ').trim().slice(0, 60), 'Ticked'); note(`☑ ${f.ownText || f.label}`); }
        return;
      }
      if (f.type === 'radio') return; // handled per group
      if (f.type === 'range') {
        const v = valueFor(f, 'number', profile);
        await el.evaluate((n, val) => { n.value = val; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); }, v);
        filled.set(f.id, v); return;
      }
      if (f.contentEditable) { await el.click(); await el.fill(override ?? valueFor(f, cls, profile)); filled.set(f.id, 'text'); return; }
      const v = override ?? valueFor(f, cls, profile);
      await el.fill(String(v));
      // Masked fields (phone, dates) ignore values set directly: type it key by key instead.
      const dv = String(v).replace(/\D/g, '');
      const ok = async () => { const cur = await el.inputValue().catch(() => ''); return dv.length >= 6 ? cur.replace(/\D/g, '').includes(dv.slice(-7)) : !!cur; };
      if (!(await ok())) { await el.fill(''); await el.pressSequentially(String(v), { delay: 15 }); if (!(await ok()) && dv.length >= 7) { await el.fill(''); await el.pressSequentially(dv.replace(/^1(?=\d{10}$)/, ''), { delay: 15 }); } }
      await el.dispatchEvent('blur').catch(() => {});
      filled.set(f.id, v); if (!PROFILE_CLS.has(cls)) answers.set(String(f.label || f.placeholder || f.name || cls).replace(/\s*\*\s*/g, ' ').trim().slice(0, 60), String(v).slice(0, 80)); note(`${(f.label || f.name || cls).slice(0, 40)} [${cls}] → ${String(v).slice(0, 40)}`);
    } catch (e) { note(`could not fill ${f.label || f.name}: ${e.message.split('\n')[0]}`); if (e.message === 'unsupported-file-type') throw e; }
  };
  const fillRadios = async (fields) => {
    const groups = {};
    for (const f of fields.filter(x => x.type === 'radio' && x.visible && !x.disabled)) (groups[f.group || f.id] ||= []).push(f);
    for (const [g, items] of Object.entries(groups)) {
      if (items.some(i => i.checked) && !filled.has('g:' + g)) { filled.set('g:' + g, 'pre'); continue; }
      if (filled.has('g:' + g)) continue;
      const cands = items.map((i, k) => ({ value: String(k), text: i.ownText || i.value, disabled: false }));
      const pref = cands.find(c => PREFER.radio.test(c.text)) || pick(cands);
      await loc(items[+pref.value].id).check({ force: true }).catch(async () => { await loc(items[+pref.value].id).click({ force: true }); });
      filled.set('g:' + g, pref.text); answers.set(String(items[0].groupLabel || g).replace(/\s*\*\s*/g, ' ').trim().slice(0, 60), pref.text); note(`◉ ${items[0].groupLabel || g} → ${pref.text}`);
    }
  };
  const fillAll = async () => {
    for (const f of scan.fields) { if (!filled.has(f.id) && f.type !== 'radio') await fillField(f); }
    await fillRadios(scan.fields);
    // Required checkbox groups (one must be ticked): tick the first non-"none" option.
    const cbGroups = {};
    for (const f of scan.fields.filter(x => x.type === 'checkbox' && x.visible && x.group)) (cbGroups[f.group] ||= []).push(f);
    for (const [g, items] of Object.entries(cbGroups)) {
      if (items.length < 2 || items.some(i => filled.has(i.id))) continue;
      const groupRequired = items.some(i => i.required) || /\*|required|at least|select (one|all)/i.test(items[0].groupLabel);
      if (!groupRequired) continue;
      const it = items.find(i => !/none|n\/a/i.test(i.ownText)) || items[0];
      await loc(it.id).check({ force: true }).catch(() => {}); filled.set(it.id, 'checked'); answers.set(String(items[0].groupLabel || g).replace(/\s*\*\s*/g, ' ').trim().slice(0, 60), it.ownText); note(`☑ ${items[0].groupLabel || g} → ${it.ownText}`);
    }
  };

  // Validity: ask the browser which fields are invalid, then fix them.
  const invalidFields = async () => frame.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[data-lh-root] [data-lh]')) {
      if (el.disabled || !el.willValidate) continue;
      const shown = (n) => !!(n && n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden');
      if (!shown(el) && !((el.type === 'checkbox' || el.type === 'radio' || el.type === 'file') && shown(el.closest('label') || el.parentElement))) continue;
      if (!el.checkValidity()) { const v = el.validity; out.push({ id: el.getAttribute('data-lh'), msg: el.validationMessage, flags: Object.keys(Object.getPrototypeOf(v)).filter(k => v[k] && k !== 'valid') }); }
    }
    return out;
  });
  const visibleErrors = async () => frame.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 1 && r.height > 1 && s.display !== 'none' && s.visibility !== 'hidden'; };
    const errs = [];
    const sel = '[role="alert"],.error,.errors,.field-error,.invalid-feedback,.help-block.error,.wpcf7-not-valid-tip,.gfield_validation_message,.wpforms-error,.form-error,.error-message,.err,[class*="error-msg"],[aria-live="assertive"]';
    for (const e of document.querySelectorAll(sel)) {
      const t = (e.innerText || '').trim(); if (!t || !vis(e) || t.length > 220) continue;
      // nearest field
      let fieldId = null;
      const ref = e.getAttribute('id') && document.querySelector(`[aria-describedby~="${CSS.escape(e.id)}"]`);
      const one = (box) => { if (!box) return null; const fs = box.querySelectorAll('[data-lh]'); const names = new Set([...fs].map(x => x.name || x.getAttribute('data-lh'))); return fs.length && names.size === 1 ? fs[0] : null; };
      const prev = e.previousElementSibling;
      const near = ref || (prev && prev.matches('[data-lh]') ? prev : null) || (prev && one(prev)) || one(e.parentElement) || one(e.parentElement?.parentElement);
      if (near) fieldId = near.getAttribute('data-lh');
      errs.push({ text: t, fieldId });
    }
    for (const el of document.querySelectorAll('[data-lh][aria-invalid="true"]')) errs.push({ text: 'invalid', fieldId: el.getAttribute('data-lh') });
    return errs;
  });
  const fixField = async (id, hint) => {
    const f = scan.fields.find(x => x.id === id); if (!f) return false;
    const cls = classify(f), h = (hint || '').toLowerCase();
    const sig = 'tried:' + (f.name || f.label || id); const tried = (filled.get(sig) || 0) + 1; filled.set(sig, tried);
    if (tried > 4) return false;
    if (f.type === 'checkbox') { await loc(id).check({ force: true }).catch(() => {}); filled.set(id, 'checked'); return true; }
    if (f.type === 'radio') { filled.delete('g:' + (f.group || f.id)); await fillRadios(scan.fields.filter(x => x.group === f.group)); return true; }
    if (f.tag === 'select' || f.role) { filled.delete(id); await fillField(f); return true; }
    let v;
    if (cls === 'phone' || /phone|digit|number/.test(h)) { const vs = phoneVariants(profile.phone); const ex = (hint || '').match(/[(+]?\d[\d ().+-]{8,}\d/); v = ex ? mirrorFormat(ex[0], profile.phone) : /digit|numbers only|without/.test(h) ? digitsOf(profile.phone).slice(-10) : vs[tried % vs.length]; }
    else if (cls === 'website' || f.type === 'url' || /\burl\b|website|http/.test(h)) v = urlOf(profile);
    else if (cls === 'confirm_email' || (/\bmatch/.test(h) && /mail/.test(h))) v = profile.email;
    else if (/at least (\d+)|minimum (of )?(\d+)|(\d+) characters/.test(h)) { const n = +(h.match(/(\d+)/) || [0, 30])[1]; v = pad(String(filled.get(id) || valueFor(f, cls, profile)), n + 1); }
    else if (/too long|at most|maximum|no more than/.test(h)) { const n = +(h.match(/(\d+)/) || [0, 50])[1]; v = String(filled.get(id) || '').slice(0, n); }
    else if (/email/.test(h)) v = profile.email;
    else if (/url|website|http/.test(h)) v = urlOf(profile);
    else if (/zip|postal/.test(h)) v = (profile.zip || '78701').slice(0, 5);
    else v = valueFor(f, cls === 'text' ? 'text' : cls, profile);
    if (opts.resolveField && tried >= 2) { try { const ai = await opts.resolveField({ field: f, error: hint, current: filled.get(id) }); if (ai) v = ai; } catch { /* fall back to rules */ } }
    await loc(id).fill(String(v)).catch(() => {}); filled.set(id, v); note(`fix ${f.label || f.name} (${hint || 'invalid'}) → ${String(v).slice(0, 40)}`);
    return true;
  };
  const fixInvalid = async () => {
    for (let round = 0; round < 4; round++) {
      const bad = await invalidFields();
      if (!bad.length) return true;
      for (const b of bad) await fixField(b.id, b.msg + ' ' + b.flags.join(' '));
    }
    return !(await invalidFields()).length;
  };

  // Multi-step forms: fill what's visible, press Next, look again.
  for (let step = 0; step < 6; step++) {
    await fillAll();
    await fixInvalid();
    const submitBtn = pickSubmit(scan.buttons);
    const nextBtn = scan.buttons.find(b => NEXT_TEXT.test(b.text));
    if (nextBtn && (!submitBtn || submitBtn.id === nextBtn.id || !SUBMIT_TEXT.test(submitBtn.text))) {
      note(`next step (${nextBtn.text})`);
      await frame.locator(`[data-lh-btn="${nextBtn.id}"]`).click();
      await page.waitForTimeout(500);
      const errs = await visibleErrors();
      for (const e of errs.filter(x => x.fieldId)) await fixField(e.fieldId, e.text);
      if (errs.length) { await frame.locator(`[data-lh-btn="${nextBtn.id}"]`).click().catch(() => {}); await page.waitForTimeout(400); }
      const prevMax = maxId; const s2 = await frame.evaluate(scanInPage, maxId); if (s2.found) { scan = s2; maxId = s2.maxId; }
      if (maxId === prevMax && step > 2) break;
      continue;
    }
    // Conditional fields may have appeared after our choices.
    const s2 = await frame.evaluate(scanInPage, maxId);
    if (s2.found) { const newOnes = s2.fields.filter(x => x.visible && !filled.has(x.id) && !scan.fields.some(y => y.id === x.id && y.visible)); scan = s2; maxId = s2.maxId; if (newOnes.length) { note(`${newOnes.length} new field(s) appeared`); continue; } }
    break;
  }

  // Some sites only load their CAPTCHA once you start typing: look again before pressing send.
  const captchaNow = async () => {
    for (const fr of [frame, page.mainFrame()]) {
      const p = await evalIn(fr, captchaInPage).catch(() => null);
      if (p && p.kind === 'visible') { captchaNow.type = p.type; return true; }
    }
    return false;
  };
  // After a successful send many forms simply empty themselves or disappear.
  const formCleared = async () => frame.evaluate((ids) => {
    if (!window.__lhDoc) return null;   // a new page loaded: only a thank-you text or URL counts there
    const errSel = '[role="alert"],.error,.errors,.field-error,.invalid-feedback,.wpcf7-not-valid-tip,.gfield_validation_message,.wpforms-error,.form-error,.error-message';
    if ([...document.querySelectorAll(errSel)].some(e => e.getBoundingClientRect().height > 1 && (e.innerText || '').trim())) return null;
    const root = document.querySelector('[data-lh-root]');
    if (!root || !root.isConnected) return 'gone';
    const r = root.getBoundingClientRect(); if (r.height < 2 || getComputedStyle(root).display === 'none') return 'hidden';
    const els = ids.map(id => document.querySelector(`[data-lh="${id}"]`)).filter(e => e && (e.tagName === 'TEXTAREA' || /^(text|email|tel|url|)$/.test(e.type || '')));
    if (els.length >= 2 && els.filter(e => !e.value).length / els.length >= 0.8) return 'cleared';
    return null;
  }, [...filled.keys()].filter(k => !String(k).includes(':'))).catch(() => null);
  mk('filled');
  // Test run: everything is filled and valid, but nothing is sent.
  if (opts.dryRun) {
    const btn = pickSubmit(scan.buttons), bad = await invalidFields().catch(() => []);
    const count = [...filled.keys()].filter(k => !String(k).startsWith('tried:')).length;
    if (!btn) return { status: 'failed', reason: 'no-submit-button', log };
    if (bad.length) return { status: 'failed', reason: 'fields-still-invalid', log };
    if (await captchaNow()) return { status: 'manual', reason: 'captcha', captcha: captchaNow.type, answers: answersText(), log };
    return { status: 'ready', evidence: `Filled ${count} field${count === 1 ? '' : 's'}, ready to send with “${btn.text || 'Submit'}”`, answers: answersText(), log };
  }
  // Submit, then read the outcome. Fix and resubmit when the site shows errors.
  let responses = [];
  page.on('response', (r) => { const m = r.request().method(); if (m === 'POST' || m === 'PUT') responses.push(r); });
  for (let attempt = 0; attempt < 4; attempt++) {
    const btn = pickSubmit(scan.buttons);
    if (!btn) return { status: 'failed', reason: 'no-submit-button', log };
    if (attempt === 0 && await captchaNow()) return { status: 'manual', reason: 'captcha', captcha: captchaNow.type, answers: answersText(), log };
    responses = [];
    note(`submit (${btn.text || btn.type})${attempt ? ` attempt ${attempt + 1}` : ''}`);
    const nav = page.waitForNavigation({ timeout: 8000 }).catch(() => null);
    const errCount = async () => { try { return (await visibleErrors()).length + (await invalidFields()).length; } catch (e) { return 0; } };
    const errBefore = await errCount();
    await frame.locator(`[data-lh-btn="${btn.id}"]`).click({ timeout: 5000 }).catch(async () => { await frame.locator(`[data-lh-btn="${btn.id}"]`).click({ force: true }); });
    const outcome = await waitOutcome(page, frame, before, startUrl, () => responses, nav, async () => (await errCount()) > errBefore, formCleared);
    if (outcome.success) return { status: 'confirmed', evidence: outcome.evidence, answers: answersText(), filled: [...filled.entries()].filter(([k]) => !String(k).includes(':')).length, log };
    // Errors? Re-sync with the page (it may have been re-rendered by the server), fix, retry.
    // We only resubmit when the site shows an error, so a working form is never sent twice.
    let errorsSeen = 0;
    try {
      // The site already accepted a send: only a visible error message justifies sending again (empty fields after a reset do not).
      if (outcome.submittedOk && !(await visibleErrors()).length) return { status: 'submitted', reason: 'sent-no-confirmation', evidence: outcome.evidence, answers: answersText(), log };
      const s2 = await frame.evaluate(scanInPage, maxId);
      if (s2.found) {
        const rerendered = !s2.fields.some(x => scan.fields.some(y => y.id === x.id));
        scan = s2; maxId = s2.maxId;
        if (rerendered) { for (const k of [...filled.keys()]) if (!String(k).startsWith('tried:')) filled.delete(k); note('page re-rendered, refilling'); }
        await fillAll();
      }
      const errs = await visibleErrors();
      const inv = await invalidFields();
      for (const b of inv) { if (outcome.submittedOk && b.flags.length === 1 && b.flags[0] === 'valueMissing') continue; errorsSeen++; await fixField(b.id, b.msg + ' ' + b.flags.join(' ')); }
      for (const e of errs) {
        errorsSeen++;
        if (e.fieldId && scan.fields.some(f => f.id === e.fieldId)) { await fixField(e.fieldId, e.text); continue; }
        const t = e.text.toLowerCase();
        const KW = { phone: /phone|mobile|tel\b/, email: /e-?mail/, confirm_email: /match|confirm/, zip: /zip|postal/, website: /url|website/, message: /message|comment|details/, first: /first name/, last: /last name/, name: /\bname\b/, date: /date/, time: /time/, company: /company|business/, file: /file|upload|attach/ };
        const live = scan.fields.filter(f => f.visible && !f.trap);
        const m = live.find(f => KW[classify(f)]?.test(t)) || live.find(f => (f.label || f.placeholder || f.name || '').toLowerCase().replace(/[*:()]/g, ' ').split(/\s+/).some(w => w.length > 3 && t.includes(w)));
        if (m) await fixField(m.id, e.text);
      }
    } catch (err) { note('re-sync failed: ' + err.message.split('\n')[0]); }
    if (!errorsSeen) return { status: outcome.submittedOk ? 'submitted' : 'failed', reason: outcome.reason || 'no-confirmation', evidence: outcome.evidence, answers: answersText(), log };
  }
  return { status: 'failed', reason: 'gave-up-after-retries', log };
}

function pickSubmit(buttons) {
  const cands = buttons.filter(b => !NEXT_TEXT.test(b.text) && !/back|previous|cancel|reset|clear|close|upload|browse|choose file|add file/i.test(b.text));
  return cands.find(b => b.type === 'submit' && SUBMIT_TEXT.test(b.text)) || cands.find(b => SUBMIT_TEXT.test(b.text)) || cands.find(b => b.type === 'submit') || cands[cands.length - 1] || null;
}

async function waitOutcome(page, frame, before, startUrl, getResponses, nav, newErrors, formCleared) {
  const started = Date.now();
  await Promise.race([nav, page.waitForTimeout(700)]);
  while (Date.now() - started < 9000) {
    try {
      const url = page.url();
      if (url !== startUrl && /thank|success|confirm|sent|received|complete/i.test(url)) return { success: true, evidence: `Redirected to ${new URL(url).pathname}` };
      const now = await page.evaluate(() => document.body.innerText);
      const frameText = frame !== page.mainFrame() ? await frame.evaluate(() => document.body.innerText).catch(() => '') : '';
      for (const text of [now, frameText]) {
        const m = text.match(SUCCESS);
        if (m && (!before.match(SUCCESS) || text.split(m[0]).length > before.split(m[0]).length)) {
          const line = text.split('\n').find(l => SUCCESS.test(l)) || m[0];
          return { success: true, evidence: line.trim().slice(0, 160) };
        }
      }
      for (const r of getResponses()) {
        if (r.status() >= 200 && r.status() < 300) {
          const ct = r.headers()['content-type'] || '';
          if (ct.includes('json')) { const j = await r.json().catch(() => null); if (j && (j.status === 'mail_sent' || j.success === true || j.ok === true || j.result === 'success')) return { success: true, evidence: `Server replied ${j.status || 'success'}` }; }
        }
      }
      // The site accepted the send (2xx) and the form emptied itself or went away: that's how many forms confirm.
      if (formCleared && Date.now() - started > 1200 && getResponses().some(r => r.status() >= 200 && r.status() < 300)) {
        const how = await formCleared(); if (how) return { success: true, evidence: how === 'cleared' ? 'The site accepted the message and cleared the form' : 'The site accepted the message and closed the form' };
      }
      // The page now shows a new validation or server error: stop waiting and go fix it.
      if (Date.now() - started > 1200 && newErrors && await newErrors()) return { success: false, submittedOk: false, reason: 'validation-error' };
    } catch { /* navigating */ }
    await page.waitForTimeout(400);
  }
  const ok = getResponses().some(r => r.status() >= 200 && r.status() < 400);
  return { success: false, submittedOk: ok, reason: ok ? 'sent-no-confirmation' : 'no-response', evidence: ok ? 'The site accepted the request but showed no confirmation' : '' };
}
