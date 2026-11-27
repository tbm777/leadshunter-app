// LeadsHunter outreach pages: campaigns, manual queue, messages, sender profiles. Plugs into app.js through install().
import { personalize, cleanCompanyName, MERGE_TAGS, unknownTags } from './shared/personalize.js';
import { render as renderFile, ASSETS } from './shared/templates/bat-marketing.js';
import { SENDER_FALLBACKS, OTHER_FIELDS } from './shared/fallbacks.js';

let A;                       // helpers from app.js
const OS = { loaded: false, senders: [], campaigns: [], manual: 0 };
const CP = {};               // campaign page state, per open campaign
const MQ = { items: [], sel: 0, loading: false };
const MS = { items: [], campaign: 0, result: 'all', more: false, loading: false };
let pollT = 0;
const stopPoll = () => { clearInterval(pollT); pollT = 0; };

/* ------------------------------------------------------------------ vocabulary */
const ST_LABEL = { queued: 'Queued', sending: 'Sending', sent: 'Sent', submitted: 'Sent', sent_manual: 'Sent by you', manual: 'Needs you', failed: 'Failed', skipped: 'Skipped' };
const ST_COLOR = { queued: 'var(--idle)', sending: 'var(--warn)', sent: 'var(--ok)', submitted: 'var(--ok)', sent_manual: 'var(--ok)', manual: 'var(--manual)', failed: 'var(--bad)', skipped: 'var(--idle)' };
const REASON = {
  captcha: 'The form has a CAPTCHA', 'login-required': 'The form needs a login', interrupted: 'The run stopped mid-send. Check whether it went through.',
  'no-form': 'No contact form found on the site', 'site-too-slow': 'The site was too slow to load', 'site-unreachable': 'The site could not be reached',
  'page-error': 'The page broke while filling the form', 'no-submit-button': 'The form has no send button', 'fields-still-invalid': 'The form kept rejecting a field',
  'gave-up-after-retries': 'The site kept rejecting the form', 'sent-no-confirmation': 'Sent, but the site showed no confirmation', 'no-response': 'The site did not respond to the send',
  'no-confirmation': 'The site showed no confirmation', 'validation-error': 'The form kept rejecting a field', 'file-type': 'The form only accepts Word files',
  'skipped by you': 'Skipped by you', 'do not contact': 'Marked do not contact', 'no-contact-form': 'No contact form found',
};
const reasonText = r => REASON[r] || (r ? String(r).replace(/-/g, ' ') : '');
const pill = (st) => `<span class="pill" style="--c:${ST_COLOR[st] || 'var(--idle)'}">${ST_LABEL[st] || st}</span>`;
const CSTATUS = { draft: ['Draft', 'var(--idle)'], active: ['Active', 'var(--ok)'], paused: ['Paused', 'var(--warn)'], archived: ['Archived', 'var(--idle)'] };
const cpill = c => `<span class="pill" style="--c:${CSTATUS[c.status][1]}">${CSTATUS[c.status][0]}</span>`;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hourLbl = h => h === 0 || h === 24 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`;
function daysLbl(w) {
  if (w === '0123456') return 'Every day'; if (w === '12345') return 'Mon–Fri';
  return [...w].map(d => DAYS[+d]).join(', ');
}
const schedLbl = c => `${daysLbl(c.weekdays)}, ${hourLbl(c.window_start)}–${hourLbl(c.window_end)} PT`;
const contacted = c => c.counts.sent + c.counts.submitted + c.counts.sent_manual;
const jobActive = j => j && ['queued', 'running'].includes(j.status);
const senderOf = c => OS.senders.find(s => s.id === c.sender_id);
const domain = u => String(u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '');
const initials = s => ((s.first_name || '?')[0] + (s.last_name || '')[0]).toUpperCase();

function leadFor(it) {
  const L = A.ST.byId.get(it.lead_id);
  const ind = A.ST.industries.find(d => d.id === (L?.industry_id ?? it.industry_id));
  return { name: it.name || L?.name, city: it.city || L?.city, state: it.region || L?.region, industry: ind?.name || '', website: it.website || L?.website };
}
const SAMPLE = { name: 'Summit Roofing Co. - #1 Roofer in Austin', city: 'Austin', state: 'TX', industry: 'Roofing' };

/* ------------------------------------------------------------------ data */
export async function loadOutreach() {
  try {
    const r = await A.api('GET', '/api/outreach');
    OS.senders = r.senders; OS.campaigns = r.campaigns; OS.manual = r.manual; OS.loaded = true;
    A.renderNav(A.currentView());
  } catch (e) { if (e.status !== 401) console.warn('Outreach unavailable', e); }
}
function upsertCampaign(c) { const i = OS.campaigns.findIndex(x => x.id === c.id); if (i >= 0) OS.campaigns[i] = c; else OS.campaigns.unshift(c); }

/* ------------------------------------------------------------------ campaigns list */
function campaignsView() {
  if (!OS.loaded) { loadOutreach().then(() => A.currentView() === 'campaigns' && A.render()); return loading(); }
  const cs = OS.campaigns;
  const today = cs.reduce((a, c) => a + c.today, 0), all = cs.reduce((a, c) => a + contacted(c), 0), queued = cs.reduce((a, c) => a + c.counts.queued, 0);
  return `<div class="head"><div><div class="eyebrow">Outreach</div><h1>Campaigns</h1><p>Each campaign sends one message through contact forms, at the pace you set. Sending runs on GitHub, so it costs nothing.</p></div>
    <div class="row"><button class="btn primary" data-o="newcamp">${A.ic('plus')}New campaign</button></div></div>
  ${!OS.senders.length ? `<div class="note">${A.ic('alert')}<div><b>Start with a sender profile.</b> Forms ask for your name, email and phone, so the campaign needs them before it can send. <button class="linkbtn" data-o="newsender">Create sender profile</button></div></div>` : ''}
  ${cs.length ? `<div class="card ministats ostats">
    <div><span>Sent today</span><b class="num">${A.fmt(today)}</b></div><div><span>Sent all time</span><b class="num">${A.fmt(all)}</b></div>
    <div><span>Queued</span><b class="num">${A.fmt(queued)}</b></div><a href="#manual" class="${OS.manual ? 'hot' : ''}"><span>Needs you</span><b class="num">${A.fmt(OS.manual)}</b></a></div>
  <div class="card camps">${cs.map(campRow).join('')}</div>` : emptyCampaigns()}`;
}
function campRow(c) {
  const n = c.counts, done = contacted(c), tot = n.total || 0, s = senderOf(c);
  const seg = (v, col) => v ? `<i style="width:${(v / Math.max(1, tot) * 100).toFixed(2)}%;background:${col}"></i>` : '';
  const live = jobActive(c.job);
  return `<a class="camp" href="#campaign/${c.id}">
    <div><h4>${A.esc(c.name)}</h4><div class="meta">${cpill(c)}<span>${s ? A.esc(s.label) : '<span style="color:var(--warn)">No sender</span>'}</span><span>${c.daily_limit}/day</span><span>${schedLbl(c)}</span></div></div>
    <div class="prog"><div class="t"><span><b class="num" style="color:var(--ink)">${A.fmt(done)}</b> of ${A.fmt(tot)} contacted</span>${n.manual ? `<span style="color:var(--manual)">${A.fmt(n.manual)} need you</span>` : ''}</div>
      <div class="seg">${seg(done, 'var(--ok)')}${seg(n.manual, 'var(--manual)')}${seg(n.failed + n.skipped, 'var(--bad)')}${seg(n.sending, 'var(--warn)')}</div></div>
    <div class="ctoday">${live ? `<span class="okline" style="color:var(--warn)"><span class="spin"></span>${c.job.mode === 'test' ? 'Testing' : 'Sending'} ${c.job.done}/${c.job.total}</span>` : `<b class="num">${A.fmt(c.today)}</b><span> / ${c.daily_limit} today</span>`}</div></a>`;
}
function emptyCampaigns() {
  const step = (n, t, d, on) => `<div class="ostep ${on ? 'on' : ''}"><i>${n}</i><div><b>${t}</b><span>${d}</span></div></div>`;
  return `<div class="card"><div class="empty" style="padding:36px 20px 28px"><b>No campaigns yet</b>Three steps and you're sending.</div>
    <div class="osteps">${step(1, 'Sender profile', 'Your name, email and phone for the forms.', !OS.senders.length)}${step(2, 'Write the message', 'Subject and message, with the company name filled in.', OS.senders.length)}${step(3, 'Add leads and start', 'Pick leads on the Leads page, test, then start.', false)}</div>
    <div class="row" style="justify-content:center;padding:0 0 28px">${OS.senders.length ? `<button class="btn primary" data-o="newcamp">${A.ic('plus')}New campaign</button>` : `<button class="btn primary" data-o="newsender">${A.ic('plus')}Create sender profile</button>`}</div></div>`;
}
function newCampaignModal(then) {
  A.$('#overlay').innerHTML = `<div class="scrim modal-scrim" data-act="close"><div class="modal" data-stop role="dialog" aria-label="New campaign">
    <div class="card-h"><div><h2>New campaign</h2><p>You can change everything later.</p></div><button class="btn ghost sm" data-act="close" aria-label="Close">${A.ic('x')}</button></div>
    <div class="card-b" style="display:flex;flex-direction:column;gap:14px">
      <div class="field"><label for="nc-name">Name</label><input class="input big" id="nc-name" placeholder="e.g. Roofers, missed calls" autocomplete="off"></div>
      <div class="field"><label for="nc-sender">Send as</label>${OS.senders.length ? `<select class="input" id="nc-sender">${OS.senders.map(s => `<option value="${s.id}">${A.esc(s.label)} · ${A.esc(s.email)}</option>`).join('')}</select>` : `<div class="help">No sender profile yet. You can add one in Settings after creating the campaign.</div>`}</div>
      <div class="help" id="nc-err" style="color:var(--bad)"></div></div>
    <div class="card-h" style="border-top:1px solid var(--line);border-bottom:0;justify-content:flex-end"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-o="newcampok">Create campaign</button></div></div></div>`;
  newCampaignModal.then = then;
  setTimeout(() => A.$('#nc-name')?.focus(), 0);
}
const DEFAULT_SUBJECT = 'Quick question about [Company Name]';
async function createCampaign() {
  const name = A.$('#nc-name').value.trim(), btn = document.querySelector('[data-o="newcampok"]');
  if (!name) { A.$('#nc-err').textContent = 'Give it a name.'; return; }
  btn.disabled = true;
  try {
    const r = await A.api('POST', '/api/campaigns', { name, sender_id: A.$('#nc-sender') ? +A.$('#nc-sender').value : null, subject: DEFAULT_SUBJECT, message: '' });
    upsertCampaign(r.campaign); A.closeOverlay();
    if (newCampaignModal.then) { const f = newCampaignModal.then; newCampaignModal.then = null; f(r.campaign); }
    else { cp(r.campaign.id).tab = 'message'; location.hash = `#campaign/${r.campaign.id}`; }
  } catch (e) { A.$('#nc-err').textContent = e.message; btn.disabled = false; }
}

/* ------------------------------------------------------------------ campaign page */
const cp = id => (CP[id] ||= { tab: 'leads', filter: 'all', items: null, more: false, prevJob: null, previewIdx: 0, previewMode: 'text' });
function campaignView(arg) {
  const id = +arg, c = OS.campaigns.find(x => x.id === id);
  if (!c) { A.api('GET', `/api/campaigns/${id}`).then(r => { upsertCampaign(r.campaign); A.render(); }).catch(() => { location.hash = '#campaigns'; }); return loading(); }
  const P = cp(id);
  return `<div class="chead">
      <div><a class="back" href="#campaigns">${A.ic('back', 14)}Campaigns</a><h1>${A.esc(c.name)}</h1><div class="meta">${cpill(c)}<span>${senderOf(c) ? 'Sends as ' + A.esc(senderOf(c).label) : 'No sender yet'}</span><span>${c.daily_limit} a day</span><span>${schedLbl(c)}</span></div></div>
      <div class="row" id="c-actions">${actionsHTML(c)}</div></div>
    <div id="c-banner">${bannerHTML(c)}</div>
    ${c.status === 'draft' ? `<div id="c-ready">${readyHTML(c)}</div>` : ''}
    <div class="card ministats ostats" id="c-stats">${statsHTML(c)}</div>
    <div class="ctabs" role="tablist">${[['leads', 'Leads', c.counts.total], ['message', 'Message'], ['settings', 'Settings']].map(([k, l, n]) => `<button role="tab" aria-selected="${P.tab === k}" class="${P.tab === k ? 'on' : ''}" data-ctab="${k}">${l}${n != null ? ` <span class="n num">${A.fmt(n)}</span>` : ''}</button>`).join('')}</div>
    <div id="c-tab">${tabHTML(c)}</div>`;
}
function actionsHTML(c) {
  const live = jobActive(c.job);
  const left = Math.max(0, c.daily_limit - c.today);
  return `<button class="btn" data-o="test" ${live || !c.counts.queued ? 'disabled' : ''} title="Fills up to 10 forms and stops before pressing send">${A.ic('check', 14)}Test run</button>
    <button class="btn" data-o="sendnow" ${live || !c.counts.queued || !left || c.status === 'draft' ? 'disabled' : ''} title="${c.status === 'draft' ? 'Start the campaign first' : !left ? "Today's limit is reached" : 'Send the next batch now, outside the schedule'}">${A.ic('campaigns', 14)}Send now</button>
    ${c.status === 'active' ? `<button class="btn" data-o="pause">Pause</button>` : `<button class="btn primary" data-o="start">${A.ic('play', 13)}${c.status === 'paused' ? 'Resume' : 'Start campaign'}</button>`}`;
}
function statsHTML(c) {
  const n = c.counts;
  return `<div><span>Queued</span><b class="num">${A.fmt(n.queued + n.sending)}</b></div><div><span>Sent</span><b class="num" style="color:var(--ok)">${A.fmt(contacted(c))}</b></div>
    <div><span>Needs you</span><b class="num" style="color:${n.manual ? 'var(--manual)' : 'inherit'}">${A.fmt(n.manual)}</b></div><div><span>Failed or skipped</span><b class="num">${A.fmt(n.failed + n.skipped)}</b></div>
    <div><span>Today</span><b class="num">${A.fmt(c.today)} <small>/ ${c.daily_limit}</small></b></div>`;
}
function readyHTML(c) {
  const s = !!senderOf(c), sub = !!c.subject.trim(), msg = c.message.trim().length >= 20, leads = c.counts.total > 0;
  const item = (ok, t, act, lbl) => `<div class="rdy ${ok ? 'ok' : ''}"><i>${ok ? A.ic('check', 12) : ''}</i><span>${t}</span>${!ok ? `<button class="linkbtn" ${act}>${lbl}</button>` : ''}</div>`;
  return `<div class="card rdycard"><b>Before you start</b>${item(s, 'Sender profile', 'data-ctab="settings"', 'Choose')}${item(sub && msg, 'Subject and message', 'data-ctab="message"', 'Write')}${item(leads, 'Leads added', 'data-o="addleads"', 'Add leads')}<span class="help">Tip: a test run fills real forms without sending, so you can see what will happen.</span></div>`;
}
function bannerHTML(c) {
  const j = c.job; if (!j) return '';
  const pct = j.total ? Math.round(j.done / j.total * 100) : 0;
  if (jobActive(j)) return `<div class="jbanner live"><span class="spin"></span><div><b>${j.mode === 'test' ? 'Test run' : 'Sending'}: ${j.done} of ${j.total}</b><span>${j.status === 'queued' ? 'Starting on GitHub, usually within a minute.' : j.mode === 'test' ? 'Filling forms without sending.' : 'Results appear below as each form is sent.'}</span><div class="bar"><i style="width:${pct}%"></i></div></div>${j.run_url ? `<a class="btn ghost sm" href="${A.esc(j.run_url)}" target="_blank" rel="noopener">Run log ${A.ic('ext', 12)}</a>` : ''}</div>`;
  if (Date.now() - (j.finished_at || 0) > 6 * 3600e3) return '';
  if (j.status === 'failed') return `<div class="jbanner bad">${A.ic('alert', 16)}<div><b>The last run stopped early</b><span>${/stopped responding|did not start|crashed/i.test(j.error || '') ? "Nothing is lost: leads it hadn't reached went back to the queue, and a form that was mid-send is in the Manual queue so you can check it. The next batch starts on schedule." : A.esc(j.error || 'Unknown error')}</span></div><button class="btn ghost sm" data-o="dismissbanner">Dismiss</button></div>`;
  if (j.mode === 'test' && j.status === 'done') {
    const its = (cp(c.id).items || []).filter(i => i.test_status);
    const ready = its.filter(i => i.test_status === 'ready').length, man = its.filter(i => i.test_status === 'manual').length, bad = its.filter(i => i.test_status === 'failed').length;
    return `<div class="jbanner ok">${A.ic('check', 16)}<div><b>Test run finished: ${ready} ready${man ? `, ${man} need you` : ''}${bad ? `, ${bad} failed` : ''}</b><span>Nothing was sent. Results show in the Test column below.</span></div><button class="btn ghost sm" data-o="dismissbanner">Dismiss</button></div>`;
  }
  return '';
}
function tabHTML(c) {
  const P = cp(c.id);
  if (P.tab === 'message') return messageTab(c);
  if (P.tab === 'settings') return settingsTab(c);
  return leadsTab(c);
}

/* leads tab */
const FILTERS = [['all', 'All', null], ['queued', 'Queued', 'queued,sending'], ['sent', 'Sent', 'sent,submitted,sent_manual'], ['manual', 'Needs you', 'manual'], ['failed', 'Failed', 'failed'], ['skipped', 'Skipped', 'skipped']];
function leadsTab(c) {
  const P = cp(c.id), n = c.counts;
  const cnt = { all: n.total, queued: n.queued + n.sending, sent: contacted(c), manual: n.manual, failed: n.failed, skipped: n.skipped };
  if (!n.total) return `<div class="card"><div class="empty"><b>No leads in this campaign yet</b>Go to Leads, select the businesses you want, then choose “Add to campaign”.<div style="margin-top:14px"><button class="btn primary" data-o="addleads">${A.ic('leads', 14)}Pick leads</button></div></div></div>`;
  return `<div class="card">
    <div class="card-h ofilters"><div class="tabs">${FILTERS.map(([k, l]) => `<button class="${P.filter === k ? 'on' : ''}" data-ofilter="${k}">${l}<span class="n">${A.fmt(cnt[k])}</span></button>`).join('')}</div><button class="btn ghost sm" data-o="addleads">${A.ic('plus', 13)}Add leads</button></div>
    <div id="c-items">${itemsHTML(c)}</div></div>`;
}
function itemsHTML(c) {
  const P = cp(c.id);
  if (!P.items) { if (!P.req || P.reqDone === P.req) loadItems(c.id); return `<div class="empty"><span class="spin"></span></div>`; }
  if (!P.items.length) return `<div class="empty"><b>Nothing here</b>No leads match this filter.</div>`;
  return `<div class="oitems"><div class="oi oi-h"><div>Business</div><div>Result</div><div>Test run</div><div>When</div><div></div></div>${P.items.map(it => itemRow(it)).join('')}</div>
    ${P.more ? `<div class="card-h" style="border-top:1px solid var(--line);border-bottom:0;justify-content:center"><button class="btn ghost sm" data-o="moreitems">Load more</button></div>` : ''}`;
}
function itemRow(it, withCampaign = false) {
  const reason = it.status === 'sent' ? it.evidence : it.status === 'submitted' ? reasonText(it.reason || 'sent-no-confirmation') : ['manual', 'failed', 'skipped'].includes(it.status) ? reasonText(it.reason) : '';
  const test = it.test_status ? `<span class="dtag ${it.test_status === 'ready' ? 'okt' : it.test_status === 'manual' ? 'mant' : 'badt'}" title="${A.esc(reasonText(it.test_reason) || it.evidence || '')}">${it.test_status === 'ready' ? 'Ready' : it.test_status === 'manual' ? 'Needs you' : 'Failed'}</span>${it.test_reason ? `<small>${A.esc(reasonText(it.test_reason))}</small>` : ''}` : '<span class="faint">—</span>';
  const when = it.sent_at || it.updated_at;
  const form = it.form_url || it.website;
  return `<div class="oi" data-oid="${it.id}">
    <div class="oi-b"><b>${A.esc(it.name)}</b><span>${A.esc(domain(it.website))}${withCampaign ? ` · ${A.esc(it.campaign)}` : ''}</span></div>
    <div class="oi-r">${pill(it.status)}${reason ? `<small title="${A.esc(reason)}">${A.esc(reason)}</small>` : ''}</div>
    <div class="oi-t">${test}</div>
    <div class="oi-w num">${when ? A.esc(A.whenPT(when).replace(' PT', '')) : ''}</div>
    <div class="oi-a">${form ? `<a class="iconbtn sm" href="${A.esc(form)}" target="_blank" rel="noopener" title="Open the form" aria-label="Open the form">${A.ic('ext', 14)}</a>` : ''}
      <div class="kebab"><button class="iconbtn sm" data-o="kebab" aria-label="More actions">⋯</button></div></div></div>`;
}
function kebabMenu(it) {
  const acts = [];
  if (['manual', 'failed', 'skipped'].includes(it.status)) acts.push(['retry', A.ic('retry', 14) + 'Try again']);
  if (['manual', 'failed', 'queued'].includes(it.status)) acts.push(['sent', A.ic('check', 14) + 'Mark as sent']);
  if (['manual', 'failed', 'queued'].includes(it.status)) acts.push(['skip', A.ic('x', 14) + 'Skip']);
  if (['queued', 'manual', 'failed', 'skipped'].includes(it.status)) acts.push(['remove', A.ic('trash', 14) + 'Remove from campaign']);
  acts.push(['dnc', A.ic('shield', 14) + 'Do not contact', 'danger']);
  return `<div class="menu" role="menu">${acts.map(([a, l, cls]) => `<button role="menuitem" class="${cls || ''}" data-oact="${a}">${l}</button>`).join('')}</div>`;
}
async function loadItems(id, append = false) {
  const P = cp(id), tok = P.req = (P.req || 0) + 1;   // only the newest request's answer is used
  const f = FILTERS.find(x => x[0] === P.filter)[2];
  try {
    const r = await A.api('GET', `/api/outreach/items?campaign=${id}${f ? '&status=' + f : ''}&limit=200&offset=${append ? (P.items || []).length : 0}`);
    if (tok !== P.req) return;
    P.reqDone = tok;
    P.items = append ? [...(P.items || []), ...r.items] : r.items; P.more = r.more;
    const el = A.$('#c-items'); const c = OS.campaigns.find(x => x.id === id);
    if (el && c) el.innerHTML = itemsHTML(c);
    if (c && A.$('#c-banner')) A.$('#c-banner').innerHTML = bannerHTML(c);
    if (P.tab === 'message' && A.$('#pv')) renderPreview(c);
  } catch (e) { if (tok === P.req) A.toast(e.message, 'alert'); } finally { if (tok === P.req) P.reqDone = tok; }
}

/* message tab */
function messageTab(c) {
  const P = cp(c.id);
  const warn = unknownTags(c.subject + ' ' + c.message);
  return `<div class="msgrid">
    <div class="card"><div class="card-h"><div><h3>Message</h3><p>Sent through each business's contact form.</p></div><span class="help" id="m-save"></span></div>
      <div class="card-b" style="display:flex;flex-direction:column;gap:14px">
        <div class="field"><label for="m-subj">Subject</label><input class="input big" id="m-subj" data-msave value="${A.esc(c.subject)}" maxlength="200" placeholder="Quick question about [Company Name]"></div>
        <div class="field"><div class="row" style="justify-content:space-between"><label for="m-body">Message</label><span class="help num" id="m-count">${c.message.length} characters</span></div>
          <textarea class="input mbody" id="m-body" data-msave maxlength="5000" placeholder="Hi [Company Name] team,&#10;&#10;…&#10;&#10;Best,&#10;Your name&#10;Your company">${A.esc(c.message)}</textarea></div>
        <div class="tagbar"><span class="help">Insert</span>${MERGE_TAGS.map(t => `<button class="chip" data-tag="[${t}]">[${t}]</button>`).join('')}</div>
        <div id="m-warn">${warn.length ? `<div class="note">${A.ic('alert')}<div>${warn.map(w => `<b>${A.esc(w)}</b>`).join(', ')} ${warn.length === 1 ? "isn't a merge tag" : "aren't merge tags"} and will be sent exactly as written.</div></div>` : ''}</div>
        <div class="note neutral">${A.ic('alert')}<div>The company name comes from Google, cleaned up: “Summit Roofing Co. - #1 Roofer in Austin” becomes “Summit Roofing Co.”. End with a sign-off on its own lines (Best, / name / company) and the file styles it for you.</div></div>
      </div></div>
    <div class="card pvcard"><div class="card-h"><div class="seg-c"><button class="${P.previewMode === 'text' ? 'on' : ''}" data-pvmode="text">Form text</button><button class="${P.previewMode === 'file' ? 'on' : ''}" data-pvmode="file">File</button></div>
      <div class="row pvnav"><button class="iconbtn sm" data-pvnav="-1" aria-label="Previous lead">${A.ic('back', 14)}</button><span id="pv-who" class="help"></span><button class="iconbtn sm" data-pvnav="1" aria-label="Next lead">${A.ic('arrow', 14)}</button></div></div>
      <div id="pv" class="card-b"></div></div></div>`;
}
function previewLeads(c) { const its = cp(c.id).items || []; return its.length ? its.slice(0, 50).map(leadFor) : [SAMPLE]; }
function renderPreview(c) {
  const P = cp(c.id), el = A.$('#pv'); if (!el) return;
  const leads = previewLeads(c); P.previewIdx = ((P.previewIdx % leads.length) + leads.length) % leads.length;
  const lead = leads[P.previewIdx];
  const subj = A.$('#m-subj')?.value ?? c.subject, body = A.$('#m-body')?.value ?? c.message;
  A.$('#pv-who').textContent = lead === SAMPLE ? 'Sample business' : `${cleanCompanyName(lead.name)}${leads.length > 1 ? ` · ${P.previewIdx + 1}/${leads.length}` : ''}`;
  const s = personalize(subj, lead), m = personalize(body, lead);
  if (P.previewMode === 'file') {
    const assets = Object.fromEntries(Object.entries(ASSETS).map(([k, f]) => [k, `/templates/assets/${f}`]));
    el.innerHTML = `<div class="pvfile"><div class="pvscale"><iframe title="File preview" sandbox="allow-scripts" id="pv-frame"></iframe></div></div><p class="help" style="margin:10px 0 0">Uploaded only when a form requires a file. Image-only forms get page 1 as an image.</p>`;
    const fr = A.$('#pv-frame'); fr.srcdoc = renderFile({ subject: s, message: m }, assets);
    scalePreview();
  } else {
    const snd = senderOf(c);
    el.innerHTML = `<div class="pvform"><div class="mock-bar">${A.esc(domain(lead.website) || 'their-website.com')}/contact</div><div class="mock-body">
      <div class="mock-2"><div class="mock-f"><span>First name</span><div class="mock-i">${A.esc(snd?.first_name || '—')}</div></div><div class="mock-f"><span>Last name</span><div class="mock-i">${A.esc(snd?.last_name || '—')}</div></div></div>
      <div class="mock-2"><div class="mock-f"><span>Email</span><div class="mock-i">${A.esc(snd?.email || '—')}</div></div><div class="mock-f"><span>Phone</span><div class="mock-i">${A.esc(snd?.phone || '—')}</div></div></div>
      <div class="mock-f"><span>Subject</span><div class="mock-i ${s ? '' : 'empty'}">${A.esc(s || 'No subject yet')}</div></div>
      <div class="mock-f"><span>Message</span><div class="mock-i big pvmsg ${m ? '' : 'empty'}">${A.esc(m || 'No message yet')}</div></div>
      <div class="mock-f"><span>Anything else the form asks</span><div class="mock-i" style="background:var(--surface-2)">A sensible answer: “General inquiry”, today+2 business days, consent ticked…</div></div>
      <span class="mock-btn">Send</span></div></div>`;
  }
}
function scalePreview() {
  const box = document.querySelector('.pvfile'), sc = document.querySelector('.pvscale'); if (!box || !sc) return;
  const k = box.clientWidth / 816; sc.style.transform = `scale(${k})`; box.style.height = (2112 * k) + 'px';
}
window.addEventListener('resize', () => scalePreview());
let saveT = 0, pendingSave = null;
function queueSave(c) {
  clearTimeout(saveT); A.$('#m-save').textContent = 'Saving…';
  pendingSave = { id: c.id, subject: A.$('#m-subj').value, message: A.$('#m-body').value };
  saveT = setTimeout(flushSave, 700);
}
async function flushSave() {
  clearTimeout(saveT);
  const ps = pendingSave; if (!ps) return; pendingSave = null;
  const c = { id: ps.id }, { subject, message } = ps;
  {
    try { const r = await A.api('PUT', `/api/campaigns/${c.id}`, { subject, message }); upsertCampaign(r.campaign); const sv = A.$('#m-save'); if (sv) sv.innerHTML = `<span class="okline">${A.ic('check', 12)}Saved</span>`; const rd = A.$('#c-ready'); if (rd) rd.innerHTML = readyHTML(r.campaign); }
    catch (e) { const sv = A.$('#m-save'); if (sv) sv.innerHTML = `<span style="color:var(--bad)">${A.esc(e.message)}</span>`; else A.toast(e.message, 'alert'); }
  }
}

/* settings tab */
function settingsTab(c) {
  const hours = (sel, from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i).map(h => `<option value="${h}" ${h === sel ? 'selected' : ''}>${hourLbl(h)}</option>`).join('');
  return `<div class="card"><div class="card-b sgrid2">
    <div class="field"><label for="s-name">Campaign name</label><input class="input" id="s-name" data-ssave="name" value="${A.esc(c.name)}" maxlength="80"></div>
    <div class="field"><label for="s-sender">Send as</label><div class="row" style="flex-wrap:nowrap"><select class="input" id="s-sender" data-ssave="sender_id"><option value="">Choose a sender profile</option>${OS.senders.map(s => `<option value="${s.id}" ${s.id === c.sender_id ? 'selected' : ''}>${A.esc(s.label)} · ${A.esc(s.email)}</option>`).join('')}</select><button class="btn" data-o="newsender">${A.ic('plus', 13)}New</button></div><span class="help">Name, email and phone typed into every form.</span></div>
    <div class="field"><label for="s-limit">Daily limit</label><input class="input" id="s-limit" type="number" min="1" max="2000" data-ssave="daily_limit" value="${c.daily_limit}"><span class="help">Forms sent per day, counted in Los Angeles time.</span></div>
    <div class="field"><label>Sending hours (PT)</label><div class="row" style="flex-wrap:nowrap"><select class="input" data-ssave="window_start">${hours(c.window_start, 0, 23)}</select><span class="help">to</span><select class="input" data-ssave="window_end">${hours(c.window_end, 1, 24)}</select></div><span class="help">Business hours look the most natural.</span></div>
    <div class="field" style="grid-column:1/-1"><label>Sending days</label><div class="days" role="group">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button class="${c.weekdays.includes(String(d)) ? 'on' : ''}" data-day="${d}" aria-pressed="${c.weekdays.includes(String(d))}">${DAYS[d]}</button>`).join('')}</div></div>
    <div class="field" style="grid-column:1/-1"><label>File for forms that require an upload</label><label class="opt on" style="cursor:default"><input type="radio" checked disabled><div><b>The Bat Marketing</b><span>Two pages: your subject and message, then your offer. Attached only when a form requires a file.</span></div></label></div>
    <div style="grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:14px"><span class="help" id="s-save"></span><button class="btn ghost sm" data-o="archive" style="color:var(--bad)">${A.ic('trash', 13)}Archive campaign</button></div>
  </div></div>`;
}
async function saveSetting(c, patch) {
  const sv = A.$('#s-save'); if (sv) sv.textContent = 'Saving…';
  try { const r = await A.api('PUT', `/api/campaigns/${c.id}`, patch); upsertCampaign(r.campaign); refreshCampaignChrome(r.campaign); const s2 = A.$('#s-save'); if (s2) s2.innerHTML = `<span class="okline">${A.ic('check', 12)}Saved</span>`; }
  catch (e) { const s2 = A.$('#s-save'); if (s2) s2.innerHTML = `<span style="color:var(--bad)">${A.esc(e.message)}</span>`; }
}
function refreshCampaignChrome(c) {
  const set = (sel, html) => { const el = A.$(sel); if (el) el.innerHTML = html; };
  set('#c-actions', actionsHTML(c)); set('#c-banner', bannerHTML(c)); set('#c-stats', statsHTML(c)); set('#c-ready', readyHTML(c));
  const meta = document.querySelector('.chead .meta'); if (meta) meta.innerHTML = `${cpill(c)}<span>${senderOf(c) ? 'Sends as ' + A.esc(senderOf(c).label) : 'No sender yet'}</span><span>${c.daily_limit} a day</span><span>${schedLbl(c)}</span>`;
  const h = document.querySelector('.chead h1'); if (h) h.textContent = c.name;
  document.querySelectorAll('.ctabs [data-ctab="leads"] .n').forEach(n => { n.textContent = A.fmt(c.counts.total); });
  const fl = document.querySelector('.ofilters .tabs');
  if (fl) { const n = c.counts, cnt = { all: n.total, queued: n.queued + n.sending, sent: contacted(c), manual: n.manual, failed: n.failed, skipped: n.skipped }; fl.querySelectorAll('[data-ofilter]').forEach(b => { b.querySelector('.n').textContent = A.fmt(cnt[b.dataset.ofilter]); }); }
}

/* polling while a run is active */
async function refreshCampaign(id, { items = true } = {}) {
  const r = await A.api('GET', `/api/campaigns/${id}`); const c = r.campaign; upsertCampaign(c);
  const P = cp(id), was = P.prevJob;
  P.prevJob = c.job ? { id: c.job.id, status: c.job.status, done: c.job.done } : null;
  if (A.currentView() !== 'campaign' || +A.currentArg() !== id) return c;
  refreshCampaignChrome(c);
  const changed = !was || !P.prevJob || was.done !== P.prevJob.done || was.status !== P.prevJob.status;
  if (items && changed && P.tab === 'leads') loadItems(id);
  if (was && jobActive(was) && c.job && !jobActive(c.job)) {
    stopPoll(); loadItems(id); A.sync(); loadOutreach();
    A.toast(c.job.status === 'failed' ? 'The run failed. See the banner for details.' : c.job.mode === 'test' ? 'Test run finished. Nothing was sent.' : `Run finished: ${contacted(c)} sent in total`, c.job.status === 'failed' ? 'alert' : 'check');
  }
  if (jobActive(c.job) && !pollT) pollT = setInterval(() => refreshCampaign(id).catch(() => {}), 4000);
  return c;
}
function mountCampaign(arg) {
  const id = +arg, c = OS.campaigns.find(x => x.id === id); if (!c) return;
  const P = cp(id); P.items = null; P.prevJob = c.job ? { id: c.job.id, status: c.job.status, done: c.job.done } : null;
  loadItems(id);
  if (P.tab === 'message') renderPreview(c);
  refreshCampaign(id, { items: false }).catch(() => {});
}

/* ------------------------------------------------------------------ add to campaign (from Leads) */
const AC = { ids: [], cid: null, includeContacted: false, summary: null };
export function addToCampaign(ids) {
  AC.ids = ids; AC.summary = null; AC.includeContacted = false;
  if (!OS.loaded) { loadOutreach().then(() => addToCampaign(ids)); return; }
  const live = OS.campaigns.filter(c => c.status !== 'archived');
  AC.cid = live.find(c => c.id === AC.cid)?.id ?? live[0]?.id ?? null;
  acModal();
  if (AC.cid) acSummary();
}
function acModal() {
  const live = OS.campaigns.filter(c => c.status !== 'archived'), s = AC.summary;
  const sk = s ? Object.entries({ already: 'already in this campaign', contacted: 'already contacted', dnc: 'do not contact', noWebsite: 'no website', noForm: 'no contact form' }).filter(([k]) => s.skipped[k]).map(([k, l]) => `${A.fmt(s.skipped[k])} ${l}`) : [];
  const total = s ? s.add + s.manual : 0;
  A.$('#overlay').innerHTML = `<div class="scrim modal-scrim" data-act="close"><div class="modal" data-stop role="dialog" aria-label="Add to campaign">
    <div class="card-h"><div><h2>Add ${A.fmt(AC.ids.length)} lead${AC.ids.length === 1 ? '' : 's'} to a campaign</h2><p>Nothing is sent until the campaign is started.</p></div><button class="btn ghost sm" data-act="close" aria-label="Close">${A.ic('x')}</button></div>
    <div class="card-b" style="display:flex;flex-direction:column;gap:10px">
      ${live.length ? `<div class="acpick">${live.map(c => `<label class="opt sm ${AC.cid === c.id ? 'on' : ''}"><input type="radio" name="accamp" value="${c.id}" ${AC.cid === c.id ? 'checked' : ''}><div><b>${A.esc(c.name)}</b><span>${CSTATUS[c.status][0]} · ${A.fmt(c.counts.total)} leads · ${A.fmt(contacted(c))} sent</span></div></label>`).join('')}</div>` : `<p style="margin:0;color:var(--muted)">You don't have a campaign yet.</p>`}
      <button class="linkbtn" data-o="acnew" style="align-self:flex-start">${A.ic('plus', 12)} New campaign</button>
      ${AC.cid ? `<div class="acsum">${!s ? `<span class="spin"></span> Checking these leads…` : `
        <div class="acline ok"><b class="num">${A.fmt(s.add)}</b> will be queued for sending</div>
        ${s.manual ? `<div class="acline man"><b class="num">${A.fmt(s.manual)}</b> go to the Manual queue (their form has a CAPTCHA)</div>` : ''}
        ${sk.length ? `<div class="acline skip"><b class="num">${A.fmt(Object.values(s.skipped).reduce((a, b) => a + b, 0))}</b> skipped: ${sk.join(', ')}</div>` : ''}
        ${s.skipped.contacted || AC.includeContacted ? `<label class="ck"><input type="checkbox" id="ac-inc" ${AC.includeContacted ? 'checked' : ''}> Include leads I've already contacted</label>` : ''}`}</div>` : ''}
      <div class="help" id="ac-err" style="color:var(--bad)"></div></div>
    <div class="card-h" style="border-top:1px solid var(--line);border-bottom:0;justify-content:flex-end"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-o="acgo" ${s && total ? '' : 'disabled'}>${s ? `Add ${A.fmt(total)} lead${total === 1 ? '' : 's'}` : 'Add leads'}</button></div></div></div>`;
}
async function acSummary() {
  AC.summary = null; acModal();
  try { AC.summary = await A.api('POST', `/api/campaigns/${AC.cid}/leads`, { ids: AC.ids, dry: true, includeContacted: AC.includeContacted }); }
  catch (e) { A.toast(e.message, 'alert'); }
  if (document.querySelector('[aria-label="Add to campaign"]')) acModal();
}
async function acGo() {
  const btn = document.querySelector('[data-o="acgo"]'); btn.disabled = true;
  try {
    const r = await A.api('POST', `/api/campaigns/${AC.cid}/leads`, { ids: AC.ids, includeContacted: AC.includeContacted });
    A.closeOverlay(); A.clearSelection(); A.sync(); await loadOutreach();
    const c = OS.campaigns.find(x => x.id === AC.cid);
    A.toast(`${A.fmt(r.add + r.manual)} leads added to ${c?.name || 'the campaign'}`);
    showOpenLink(AC.cid);
  } catch (e) { A.$('#ac-err').textContent = e.message; btn.disabled = false; }
}
function showOpenLink(id) {
  const t = A.$('#toast'); if (!t) return;
  t.insertAdjacentHTML('beforeend', ` <a href="#campaign/${id}" style="color:inherit;font-weight:600;margin-left:6px">Open</a>`);
}

/* ------------------------------------------------------------------ manual queue */
function manualView() {
  if (!MQ.loaded) { loadManual(); return loading(); }
  const its = MQ.items;
  return `<div class="head"><div><div class="eyebrow">Outreach</div><h1>Manual queue</h1><p>Forms the robot couldn't send on its own. Open the form, paste the fields, send, then mark it sent. Everything is already filled in for each business.</p></div>
    <div class="row"><span class="help">Shortcuts: <span class="kbd">J</span> <span class="kbd">K</span> move, <span class="kbd">S</span> mark sent</span></div></div>
  ${its.length ? `<div class="split mq"><div class="card list" id="mq-list">${mqList()}</div><div class="card" id="mq-detail">${mqDetail()}</div></div>`
    : `<div class="card"><div class="empty"><b>All clear</b>Nothing needs you right now. CAPTCHA forms and anything the robot couldn't finish land here.</div></div>`}`;
}
function mqList() {
  return MQ.items.map((it, i) => `<button class="${i === MQ.sel ? 'on' : ''}" data-mq="${i}"><b>${A.esc(cleanCompanyName(it.name))}</b><span>${A.esc(reasonText(it.reason))} · ${A.esc(it.campaign)}</span></button>`).join('');
}
function mqDetail() {
  const it = MQ.items[MQ.sel]; if (!it) return '';
  const c = OS.campaigns.find(x => x.id === it.campaign_id), snd = c && senderOf(c), lead = leadFor(it);
  const subj = c ? personalize(c.subject, lead) : '', msg = c ? personalize(c.message, lead) : '';
  const url = it.form_url || it.website;
  const f = (k, v) => v ? `<div class="mfield"><span class="k">${k}</span><span class="val">${A.esc(v)}</span><button class="dcopy" data-copy="${A.esc(v)}">${A.ic('copy', 12)}<span>Copy</span></button></div>` : '';
  return `<div class="card-h"><div><h3>${A.esc(cleanCompanyName(it.name))}</h3><p>${A.esc(reasonText(it.reason))}</p></div><span class="help num">${MQ.sel + 1} of ${MQ.items.length}</span></div>
    <div class="card-b" style="display:flex;flex-direction:column;gap:14px">
      ${url ? `<a class="btn primary mqopen" href="${A.esc(url)}" target="_blank" rel="noopener">${A.ic('ext', 15)}Open the form<span class="mqurl">${A.esc(domain(url))}</span></a>` : ''}
      <div>${f('Subject', subj)}${f('Message', msg)}${snd ? f('First name', snd.first_name) + f('Last name', snd.last_name) + f('Email', snd.email) + f('Phone', snd.phone) + f('Company', snd.company) + f('Website', snd.website) : ''}</div>
      <div class="row mqacts"><button class="btn primary" data-mqact="sent">${A.ic('check', 14)}Mark as sent</button><button class="btn" data-mqact="retry" title="Send it back to the robot">${A.ic('retry', 14)}Try robot again</button><button class="btn" data-mqact="skip">Skip</button><button class="btn ghost" data-mqact="dnc" style="color:var(--bad)">${A.ic('shield', 14)}Do not contact</button></div>
    </div>`;
}
async function loadManual() {
  if (MQ.loading) return; MQ.loading = true;
  try {
    if (!OS.loaded) await loadOutreach();
    const r = await A.api('GET', '/api/outreach/items?status=manual&order=recent&limit=500');
    MQ.items = r.items; MQ.sel = Math.min(MQ.sel, Math.max(0, MQ.items.length - 1)); MQ.loaded = true;
    if (A.currentView() === 'manual') A.render();
  } catch (e) { A.toast(e.message, 'alert'); } finally { MQ.loading = false; }
}
async function mqAction(act) {
  const it = MQ.items[MQ.sel]; if (!it) return;
  try {
    await A.api('POST', `/api/outreach/${it.id}`, { action: act });
    MQ.items.splice(MQ.sel, 1); MQ.sel = Math.min(MQ.sel, Math.max(0, MQ.items.length - 1));
    OS.manual = Math.max(0, OS.manual - 1); A.renderNav('manual');
    A.toast({ sent: 'Marked as sent', retry: 'Sent back to the robot', skip: 'Skipped', dnc: 'Marked do not contact' }[act]);
    if (!MQ.items.length) A.render(); else { A.$('#mq-list').innerHTML = mqList(); A.$('#mq-detail').innerHTML = mqDetail(); }
    A.sync();
  } catch (e) { A.toast(e.message, 'alert'); }
}

/* ------------------------------------------------------------------ messages log */
const RESULTS = [['all', 'All sent', 'sent,submitted,sent_manual'], ['sent', 'Confirmed', 'sent'], ['submitted', 'No confirmation', 'submitted'], ['sent_manual', 'Sent by you', 'sent_manual']];
function messagesView() {
  if (!MS.loaded) { loadMessages(); return loading(); }
  return `<div class="head"><div><div class="eyebrow">Outreach</div><h1>Messages</h1><p>Every form that went out, newest first. “Confirmed” means the site showed a thank-you message or redirected to a thank-you page.</p></div></div>
  <div class="card"><div class="card-h ofilters"><div class="tabs">${RESULTS.map(([k, l]) => `<button class="${MS.result === k ? 'on' : ''}" data-msres="${k}">${l}</button>`).join('')}</div>
    <select class="input" id="ms-camp" style="width:auto"><option value="0">All campaigns</option>${OS.campaigns.map(c => `<option value="${c.id}" ${MS.campaign === c.id ? 'selected' : ''}>${A.esc(c.name)}</option>`).join('')}</select></div>
    ${MS.items.length ? `<div class="oitems msg">${MS.items.map(it => `<div class="oi"><div class="oi-b"><b>${A.esc(it.name)}</b><span>${A.esc(domain(it.website))} · ${A.esc(it.campaign)}</span></div>
      <div class="oi-r">${it.status === 'sent' ? '<span class="pill" style="--c:var(--ok)">Confirmed</span>' : it.status === 'submitted' ? '<span class="pill" style="--c:var(--info)">No confirmation</span>' : '<span class="pill" style="--c:var(--ok)">Sent by you</span>'}${it.evidence ? `<small title="${A.esc(it.evidence)}">${A.esc(it.evidence)}</small>` : ''}</div>
      <div class="oi-w num">${A.esc(A.whenPT(it.sent_at))}</div><div class="oi-a">${it.form_url ? `<a class="iconbtn sm" href="${A.esc(it.form_url)}" target="_blank" rel="noopener" aria-label="Open the form">${A.ic('ext', 14)}</a>` : ''}</div></div>`).join('')}</div>
      ${MS.more ? `<div class="card-h" style="border-top:1px solid var(--line);border-bottom:0;justify-content:center"><button class="btn ghost sm" data-o="moremsgs">Load more</button></div>` : ''}`
    : `<div class="empty"><b>No messages yet</b>Sent forms show up here with the site's confirmation.</div>`}</div>`;
}
async function loadMessages(append = false) {
  if (MS.loading) return; MS.loading = true;
  try {
    if (!OS.loaded) await loadOutreach();
    const st = RESULTS.find(r => r[0] === MS.result)[2];
    const r = await A.api('GET', `/api/outreach/items?status=${st}&order=sent&limit=200&offset=${append ? MS.items.length : 0}${MS.campaign ? '&campaign=' + MS.campaign : ''}`);
    MS.items = append ? [...MS.items, ...r.items] : r.items; MS.more = r.more; MS.loaded = true;
    if (A.currentView() === 'messages') A.render();
  } catch (e) { A.toast(e.message, 'alert'); } finally { MS.loading = false; }
}

/* ------------------------------------------------------------------ sender profiles */
function sendersView() {
  if (!OS.loaded) { loadOutreach().then(() => A.currentView() === 'senders' && A.render()); return loading(); }
  const used = id => OS.campaigns.filter(c => c.sender_id === id).length;
  return `<div class="head"><div><div class="eyebrow">Outreach</div><h1>Sender profiles</h1><p>Who the message comes from. These details go into every form: name, email and phone always, the rest only when a form asks for it.</p></div>
    <div class="row"><button class="btn primary" data-o="newsender">${A.ic('plus')}New profile</button></div></div>
  <div class="profiles">${OS.senders.map(s => `<div class="card profile">
      <div class="who"><div class="avatar">${A.esc(initials(s))}</div><div style="min-width:0"><b>${A.esc(s.label)}</b><div class="help">${used(s.id) ? `Used by ${used(s.id)} campaign${used(s.id) === 1 ? '' : 's'}` : 'Not used yet'}</div></div></div>
      <dl class="ld-dl"><div class="dk"><dt>Name</dt><dd>${A.esc(s.first_name)} ${A.esc(s.last_name)}</dd></div><div class="dk"><dt>Email</dt><dd>${A.esc(s.email)}</dd></div><div class="dk"><dt>Phone</dt><dd>${A.esc(s.phone)}</dd></div><div class="dk"><dt>Company</dt><dd>${s.company ? A.esc(s.company) : `<span class="faint">${A.esc(fbHint('company', s))}</span>`}</dd></div><div class="dk"><dt>Website</dt><dd>${s.website ? A.esc(s.website) : `<span class="faint">${A.esc(fbHint('website', s))}</span>`}</dd></div>
        <div class="dk"><dt>Address</dt><dd>${[s.address, s.city, s.state, s.zip].some(Boolean) ? A.esc([s.address, s.city, [s.state, s.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')) : `<span class="faint">Placeholder: 100 Congress Ave, Austin TX 78701</span>`}</dd></div></dl>
      <div class="row" style="justify-content:flex-end;margin-top:auto"><button class="btn sm" data-o="editsender" data-sid="${s.id}">${A.ic('edit', 13)}Edit</button></div></div>`).join('')}
    <button class="card profile padd" data-o="newsender">${A.ic('plus', 20)}<b>New profile</b><span>Another name or brand to send as</span></button></div>`;
}
const fbHint = (k, s) => SENDER_FALLBACKS[k] ? SENDER_FALLBACKS[k].hint(s) : '';
function senderDrawer(s = {}, onSaved) {
  const f = (k, label, ph = '', type = 'text', help = '') => {
    const fb = SENDER_FALLBACKS[k];
    return `<div class="field"><label for="sp-${k}">${label}${fb ? ' <span class="opt-tag">optional</span>' : ''}</label><input class="input" id="sp-${k}" type="${type}" value="${A.esc(s[k] || '')}" placeholder="${fb ? A.esc(fbHint(k, s).replace(/ \(.*\)$/, '')) : ph}" autocomplete="off" data-spf="${k}">
      ${fb ? `<span class="help fbh" data-fb="${k}" ${String(s[k] || '').trim() ? 'hidden' : ''}>If left empty, forms get: <b>${A.esc(fbHint(k, s))}</b></span>` : help ? `<span class="help">${help}</span>` : ''}</div>`;
  };
  A.$('#overlay').innerHTML = `<div class="scrim" data-act="close"><div class="drawer" data-stop role="dialog" aria-label="Sender profile">
    <div class="drawer-h"><div><div class="eyebrow" style="margin:0 0 4px">${s.id ? 'Edit sender profile' : 'New sender profile'}</div><h2>${A.esc(s.label || 'Sender profile')}</h2></div><button class="btn ghost sm" data-act="close" aria-label="Close">${A.ic('x')}</button></div>
    <section><h5>Always used</h5><div class="fsrow2">${f('first_name', 'First name', 'Dustin')}${f('last_name', 'Last name', 'Morgan')}</div>${f('email', 'Email', 'you@company.com', 'email', 'Replies from businesses arrive here.')}${f('phone', 'Phone', '(512) 555-0142', 'tel', 'Typed in the format each form expects.')}</section>
    <section><h5>Your business</h5>${f('company', 'Company')}${f('website', 'Website')}</section>
    <section><h5>Address</h5><span class="help" style="margin-top:-4px">Only typed in when a form insists on an address. With no address at all, the whole placeholder address is used so city, state and ZIP match.</span>${f('address', 'Street')}<div class="fsrow2">${f('city', 'City')}${f('state', 'State')}</div>${f('zip', 'ZIP code')}</section>
    <section><h5>Questions the form asks that aren't in your profile</h5><span class="help" style="margin-top:-4px">The robot answers these so a form never fails for a missing value. Your subject and message come from the campaign.</span>
      <dl class="fblist">${OTHER_FIELDS.map(([k, v]) => `<div><dt>${A.esc(k)}</dt><dd>${A.esc(v)}</dd></div>`).join('')}</dl></section>
    <section><h5>Profile name</h5>${f('label', 'Shown in the app', s.company || 'e.g. The Bat Marketing')}</section>
    <div class="help" id="sp-err" style="color:var(--bad);padding:0 20px"></div>
    <div class="drawer-foot">${s.id ? `<button class="btn ghost" data-o="delsender" data-sid="${s.id}" style="margin-right:auto;color:var(--bad)">Delete</button>` : ''}<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-o="savesender" data-sid="${s.id || ''}">${s.id ? 'Save changes' : 'Create profile'}</button></div></div></div>`;
  senderDrawer.onSaved = onSaved;
  setTimeout(() => A.$('#sp-first_name')?.focus(), 0);
}
async function saveSender(id) {
  const b = {}; for (const k of ['first_name', 'last_name', 'email', 'phone', 'company', 'website', 'address', 'city', 'state', 'zip', 'label']) b[k] = A.$('#sp-' + k).value;
  const btn = document.querySelector('[data-o="savesender"]'); btn.disabled = true;
  try {
    const r = await A.api(id ? 'PUT' : 'POST', id ? `/api/senders/${id}` : '/api/senders', b);
    const i = OS.senders.findIndex(s => s.id === r.sender.id); if (i >= 0) OS.senders[i] = r.sender; else OS.senders.push(r.sender);
    A.closeOverlay(); A.toast(id ? 'Profile saved' : 'Profile created');
    const cb = senderDrawer.onSaved; senderDrawer.onSaved = null;
    if (cb) cb(r.sender); else A.render();
  } catch (e) { A.$('#sp-err').textContent = e.message; btn.disabled = false; }
}

/* ------------------------------------------------------------------ events */
const loading = () => `<div class="card"><div class="empty"><span class="spin"></span></div></div>`;
const curCampaign = () => A.currentView() === 'campaign' ? OS.campaigns.find(c => c.id === +A.currentArg()) : null;

async function onClick(e) {
  const t = e.target;
  if (!t.closest('.kebab')) document.querySelectorAll('.oi .menu').forEach(m => m.remove());
  const cpy = t.closest('[data-copy]');
  if (cpy) { try { await navigator.clipboard.writeText(cpy.dataset.copy); const s = cpy.querySelector('span'); s.textContent = 'Copied'; setTimeout(() => { s.textContent = 'Copy'; }, 1400); } catch { A.toast('Copy failed. Select the text instead.', 'alert'); } return; }
  const tag = t.closest('[data-tag]');
  if (tag) { insertTag(tag.dataset.tag); return; }
  const tab = t.closest('[data-ctab]');
  if (tab) { const c = curCampaign(); if (!c) return; await flushSave(); cp(c.id).tab = tab.dataset.ctab; A.render(); return; }
  const flt = t.closest('[data-ofilter]');
  if (flt) { const c = curCampaign(); const P = cp(c.id); P.filter = flt.dataset.ofilter; P.items = null; document.querySelectorAll('[data-ofilter]').forEach(b => b.classList.toggle('on', b === flt)); A.$('#c-items').innerHTML = itemsHTML(c); return; }
  const pvm = t.closest('[data-pvmode]');
  if (pvm) { const c = curCampaign(); cp(c.id).previewMode = pvm.dataset.pvmode; document.querySelectorAll('[data-pvmode]').forEach(b => b.classList.toggle('on', b === pvm)); renderPreview(c); return; }
  const pvn = t.closest('[data-pvnav]');
  if (pvn) { const c = curCampaign(); cp(c.id).previewIdx += +pvn.dataset.pvnav; renderPreview(c); return; }
  const day = t.closest('[data-day]');
  if (day) { const c = curCampaign(); const set = new Set(c.weekdays); const d = day.dataset.day; set.has(d) ? set.delete(d) : set.add(d); if (!set.size) { A.toast('Keep at least one sending day.', 'alert'); return; } day.classList.toggle('on'); saveSetting(c, { weekdays: [...set].join('') }); return; }
  const mq = t.closest('[data-mq]');
  if (mq) { MQ.sel = +mq.dataset.mq; A.$('#mq-list').innerHTML = mqList(); A.$('#mq-detail').innerHTML = mqDetail(); return; }
  const mqa = t.closest('[data-mqact]');
  if (mqa) { mqAction(mqa.dataset.mqact); return; }
  const msr = t.closest('[data-msres]');
  if (msr) { MS.result = msr.dataset.msres; MS.loaded = false; loadMessages(); return; }
  const oact = t.closest('[data-oact]');
  if (oact) { itemAct(+t.closest('[data-oid]').dataset.oid, oact.dataset.oact); return; }
  const b = t.closest('[data-o]'); if (!b) return;
  const c = curCampaign();
  switch (b.dataset.o) {
    case 'newcamp': newCampaignModal(); break;
    case 'newcampok': createCampaign(); break;
    case 'newsender': senderDrawer({}, c ? (s) => saveSetting(c, { sender_id: s.id }).then(() => A.render()) : null); break;
    case 'editsender': senderDrawer(OS.senders.find(s => s.id === +b.dataset.sid)); break;
    case 'savesender': saveSender(+b.dataset.sid || 0); break;
    case 'delsender': try { await A.api('DELETE', `/api/senders/${+b.dataset.sid}`); OS.senders = OS.senders.filter(s => s.id !== +b.dataset.sid); A.closeOverlay(); A.render(); A.toast('Profile deleted'); } catch (err) { A.$('#sp-err').textContent = err.message; } break;
    case 'addleads': location.hash = '#leads'; A.toast('Select leads, then choose “Add to campaign”'); break;
    case 'start': case 'pause': {
      b.disabled = true;
      try { const r = await A.api('POST', `/api/campaigns/${c.id}/status`, { status: b.dataset.o === 'start' ? 'active' : 'paused' }); upsertCampaign(r.campaign); A.render(); A.toast(b.dataset.o === 'start' ? (inWindowNow(r.campaign) ? 'Campaign started. The first batch is on its way.' : `Campaign started. Sending begins ${nextWindowLbl(r.campaign)}.`) : 'Paused. Nothing more will be sent.'); refreshCampaign(c.id).catch(() => {}); }
      catch (err) { A.toast(err.message, 'alert'); b.disabled = false; }
      break;
    }
    case 'test': {
      b.disabled = true;
      try { const r = await A.api('POST', `/api/campaigns/${c.id}/run`, { mode: 'test', count: 10 }); upsertCampaign(r.campaign); cp(c.id).prevJob = { status: 'queued', done: 0 }; refreshCampaignChrome(r.campaign); A.toast('Test run started. It fills up to 10 forms and sends nothing.'); refreshCampaign(c.id).catch(() => {}); }
      catch (err) { A.toast(err.message, 'alert'); b.disabled = false; }
      break;
    }
    case 'sendnow': sendNowModal(c); break;
    case 'sendnowok': {
      const n = Math.max(1, +A.$('#sn-n').value || 0); b.disabled = true;
      try { const r = await A.api('POST', `/api/campaigns/${c.id}/run`, { mode: 'send', count: n }); upsertCampaign(r.campaign); A.closeOverlay(); cp(c.id).prevJob = { status: 'queued', done: 0 }; refreshCampaignChrome(r.campaign); A.toast(`Sending ${r.campaign.job?.total || n} forms now`); refreshCampaign(c.id).catch(() => {}); }
      catch (err) { A.$('#sn-err').textContent = err.message; b.disabled = false; }
      break;
    }
    case 'archive':
      A.$('#overlay').innerHTML = `<div class="scrim modal-scrim" data-act="close"><div class="modal" data-stop role="dialog" aria-label="Archive campaign"><div class="card-h"><div><h2>Archive “${A.esc(c.name)}”?</h2></div></div><div class="card-b"><p style="margin:0">It stops sending and disappears from Campaigns. Leads keep their Contacted status, so they won't be messaged twice.</p></div>
        <div class="card-h" style="border-top:1px solid var(--line);border-bottom:0;justify-content:flex-end"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-o="archiveok" style="background:var(--bad);border-color:var(--bad);color:#fff">Archive</button></div></div></div>`;
      break;
    case 'archiveok': try { await A.api('POST', `/api/campaigns/${c.id}/status`, { status: 'archived' }); OS.campaigns = OS.campaigns.filter(x => x.id !== c.id); A.closeOverlay(); location.hash = '#campaigns'; A.toast('Campaign archived'); } catch (err) { A.toast(err.message, 'alert'); } break;
    case 'dismissbanner': A.$('#c-banner').innerHTML = ''; break;
    case 'moreitems': loadItems(c.id, true); break;
    case 'moremsgs': loadMessages(true); break;
    case 'kebab': {
      const k = b.closest('.kebab'), open = k.querySelector('.menu');
      document.querySelectorAll('.oi .menu').forEach(m => m.remove());
      if (!open) { const it = (cp(c.id).items || []).find(x => x.id === +b.closest('[data-oid]').dataset.oid); if (it) k.insertAdjacentHTML('beforeend', kebabMenu(it)); }
      break;
    }
    case 'acnew': newCampaignModal(async (camp) => { AC.cid = camp.id; addToCampaignReopen(); }); break;
    case 'acgo': acGo(); break;
  }
}
function addToCampaignReopen() { acModal(); acSummary(); }
function inWindowNow(c) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return c.weekdays.includes(String(DAYS.indexOf(p.weekday))) && +p.hour >= c.window_start && +p.hour < c.window_end;
}
function nextWindowLbl(c) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  let d = DAYS.indexOf(p.weekday);
  if (c.weekdays.includes(String(d)) && +p.hour < c.window_start) return `today at ${hourLbl(c.window_start)} PT`;
  for (let i = 1; i <= 7; i++) { const dd = (d + i) % 7; if (c.weekdays.includes(String(dd))) return `${i === 1 ? 'tomorrow' : DAYS[dd]} at ${hourLbl(c.window_start)} PT`; }
  return 'at the next sending window';
}
function sendNowModal(c) {
  const left = Math.max(0, c.daily_limit - c.today), n = Math.min(40, left, c.counts.queued);
  A.$('#overlay').innerHTML = `<div class="scrim modal-scrim" data-act="close"><div class="modal" data-stop role="dialog" aria-label="Send now">
    <div class="card-h"><div><h2>Send now</h2><p>Sends to the next queued leads right away, even outside the schedule. Today's limit still applies.</p></div><button class="btn ghost sm" data-act="close" aria-label="Close">${A.ic('x')}</button></div>
    <div class="card-b" style="display:flex;flex-direction:column;gap:10px"><div class="field"><label for="sn-n">How many</label><input class="input big" id="sn-n" type="number" min="1" max="${Math.min(left, 200)}" value="${n}"></div>
      <span class="help">${A.fmt(c.counts.queued)} queued · ${A.fmt(left)} left today. A batch of 40 takes about 3 minutes.</span><div class="help" id="sn-err" style="color:var(--bad)"></div></div>
    <div class="card-h" style="border-top:1px solid var(--line);border-bottom:0;justify-content:flex-end"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-o="sendnowok">${A.ic('campaigns', 14)}Send</button></div></div></div>`;
  setTimeout(() => A.$('#sn-n')?.select(), 0);
}
async function itemAct(oid, act) {
  const c = curCampaign(); if (!c) return;
  document.querySelectorAll('.oi .menu').forEach(m => m.remove());
  try {
    if (act === 'remove') await A.api('POST', `/api/campaigns/${c.id}/remove`, { ids: [oid] });
    else await A.api('POST', `/api/outreach/${oid}`, { action: act });
    A.toast({ retry: 'Queued again', sent: 'Marked as sent', skip: 'Skipped', remove: 'Removed from the campaign', dnc: 'Marked do not contact' }[act]);
    await refreshCampaign(c.id, { items: false }); loadItems(c.id); A.sync(); loadOutreach();
  } catch (e) { A.toast(e.message, 'alert'); }
}
let lastField = 'm-body';
function insertTag(tag) {
  const el = A.$('#' + lastField) || A.$('#m-body'); if (!el) return;
  const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? s;
  el.value = el.value.slice(0, s) + tag + el.value.slice(e); el.focus(); el.setSelectionRange(s + tag.length, s + tag.length);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function onInput(e) {
  const t = e.target, c = curCampaign();
  if (t.dataset && t.dataset.spf) { updateFallbackHints(); return; }
  if (t.dataset.msave !== undefined && c) {
    lastField = t.id;
    if (t.id === 'm-body') A.$('#m-count').textContent = `${t.value.length} characters`;
    const warn = unknownTags(A.$('#m-subj').value + ' ' + A.$('#m-body').value);
    A.$('#m-warn').innerHTML = warn.length ? `<div class="note">${A.ic('alert')}<div>${warn.map(w => `<b>${A.esc(w)}</b>`).join(', ')} ${warn.length === 1 ? "isn't a merge tag" : "aren't merge tags"} and will be sent exactly as written.</div></div>` : '';
    queueSave(c);
    try { renderPreview(c); } catch (err) { console.warn('preview', err); }
  }
}
function senderDraft() { const o = {}; document.querySelectorAll('[data-spf]').forEach(i => { o[i.dataset.spf] = i.value; }); return o; }
function updateFallbackHints() {
  const d = senderDraft();
  document.querySelectorAll('[data-fb]').forEach(h => {
    const k = h.dataset.fb, empty = !String(d[k] || '').trim();
    h.hidden = !empty; h.querySelector('b').textContent = fbHint(k, d);
    const inp = document.getElementById('sp-' + k); if (inp) inp.placeholder = fbHint(k, d).replace(/ \(.*\)$/, '');
  });
}
function onFocus(e) { if (e.target.dataset && e.target.dataset.msave !== undefined) lastField = e.target.id; }
function onChange(e) {
  const t = e.target, c = curCampaign();
  if (t.dataset.ssave && c) { const k = t.dataset.ssave; const v = ['daily_limit', 'window_start', 'window_end'].includes(k) ? +t.value : k === 'sender_id' ? (+t.value || null) : t.value; saveSetting(c, { [k]: v }); return; }
  if (t.name === 'accamp') { AC.cid = +t.value; acSummary(); return; }
  if (t.id === 'ac-inc') { AC.includeContacted = t.checked; acSummary(); return; }
  if (t.id === 'ms-camp') { MS.campaign = +t.value; MS.loaded = false; loadMessages(); return; }
}
function onKey(e) {
  if (A.currentView() !== 'manual' || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || document.querySelector('.scrim') || e.metaKey || e.ctrlKey) return;
  if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); MQ.sel = Math.min(MQ.items.length - 1, MQ.sel + 1); A.$('#mq-list').innerHTML = mqList(); A.$('#mq-detail').innerHTML = mqDetail(); document.querySelector('#mq-list .on')?.scrollIntoView({ block: 'nearest' }); }
  if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); MQ.sel = Math.max(0, MQ.sel - 1); A.$('#mq-list').innerHTML = mqList(); A.$('#mq-detail').innerHTML = mqDetail(); document.querySelector('#mq-list .on')?.scrollIntoView({ block: 'nearest' }); }
  if (e.key === 's') { e.preventDefault(); mqAction('sent'); }
}

/* ------------------------------------------------------------------ install */
export function install(ctx) {
  A = ctx;
  Object.assign(ctx.V, { campaigns: campaignsView, campaign: campaignView, manual: manualView, messages: messagesView, senders: sendersView });
  Object.assign(ctx.MOUNT, {
    campaign: mountCampaign,
    campaigns: () => { if (!pollT && OS.loaded && OS.campaigns.some(c => jobActive(c.job))) pollT = setInterval(() => loadOutreach().then(() => A.currentView() === 'campaigns' && A.render()), 6000); },
    manual: () => { if (MQ.loaded && !MQ.fresh) { MQ.fresh = true; loadManual().then(() => { MQ.fresh = false; }); } },
    messages: () => { if (MS.loaded && !MS.fresh) { MS.fresh = true; loadMessages().then(() => { MS.fresh = false; }); } },
  });
  Object.assign(ctx.TITLES, { campaigns: 'Campaigns', campaign: 'Campaign', manual: 'Manual queue', messages: 'Messages', senders: 'Sender profiles' });
  ctx.CRUMBS.campaign = (arg) => { const c = OS.campaigns.find(x => x.id === +arg); return `<a href="#campaigns">Campaigns</a><span>›</span><b>${A.esc(c ? c.name : 'Campaign')}</b>`; };
  ctx.NAV_ACTIVE.campaign = 'campaigns';
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('focusin', onFocus);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', () => { stopPoll(); flushSave(); });
  window.addEventListener('beforeunload', () => { if (pendingSave) navigator.sendBeacon && flushSave(); });
}
export const outreachNav = () => [['campaigns', 'Campaigns', 'campaigns'], ['manual', 'Manual queue', 'manual', OS.manual], ['messages', 'Messages', 'messages'], ['senders', 'Sender profiles', 'senders']];
