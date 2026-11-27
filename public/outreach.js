// LeadsHunter outreach pages: campaigns, manual queue, messages, sender profiles. Plugs into app.js through install().
import { personalize, cleanCompanyName, MERGE_TAGS, unknownTags } from './shared/personalize.js';
import { render as renderFile, ASSETS } from './shared/templates/bat-marketing.js';
import { SENDER_FALLBACKS, OTHER_FIELDS, engineProfile } from './shared/fallbacks.js';

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
  'skipped by you': 'Skipped by you', 'do not contact': 'Marked do not contact', 'already contacted': 'You marked this lead as contacted', 'directory-page': 'The website is a directory or social profile, not their own site', 'no-contact-form': 'No contact form found',
};
const SENT = ['sent', 'submitted', 'sent_manual'];
const reasonText = r => REASON[r] || (r ? String(r).replace(/-/g, ' ') : '');
const pill = (st) => `<span class="pill" style="--c:${ST_COLOR[st] || 'var(--idle)'}">${ST_LABEL[st] || st}</span>`;
const CSTATUS = { draft: ['Draft', 'var(--idle)'], active: ['Active', 'var(--ok)'], paused: ['Paused', 'var(--warn)'], archived: ['Archived', 'var(--idle)'] };
const scheduled = c => c.status === 'active' && c.start_at && c.start_at > Date.now();
const cpill = c => scheduled(c) ? '<span class="pill" style="--c:var(--info)">Scheduled</span>' : `<span class="pill" style="--c:${CSTATUS[c.status][1]}">${CSTATUS[c.status][0]}</span>`;
const startLbl = c => scheduled(c) ? `Starts ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(c.start_at))} PT` : '';
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
    <div><h4>${A.esc(c.name)}</h4><div class="meta">${cpill(c)}${scheduled(c) ? `<span style="color:var(--info)">${startLbl(c)}</span>` : ''}<span>${s ? A.esc(s.label) : '<span style="color:var(--warn)">No sender</span>'}</span><span>${c.daily_limit}/day</span><span>${schedLbl(c)}</span></div></div>
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
      <div><a class="back" href="#campaigns">${A.ic('back', 14)}Campaigns</a><h1>${A.esc(c.name)}</h1><div class="meta">${cpill(c)}${scheduled(c) ? `<span style="color:var(--info);font-weight:550">${startLbl(c)}</span>` : ''}<span>${senderOf(c) ? 'Sends as ' + A.esc(senderOf(c).label) : 'No sender yet'}</span><span>${c.daily_limit} a day</span><span>${schedLbl(c)}</span></div></div>
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
    ${c.status === 'active' ? `<button class="btn" data-o="pause">${scheduled(c) ? 'Cancel schedule' : 'Pause'}</button>` : `<button class="btn primary" data-o="start">${A.ic('play', 13)}${c.status === 'paused' ? 'Resume' : 'Start campaign'}</button>`}`;
}
function statsHTML(c) {
  const n = c.counts;
  return `<div><span>Queued</span><b class="num">${A.fmt(n.queued + n.sending)}</b></div><div><span>Sent</span><b class="num" style="color:var(--ok)">${A.fmt(contacted(c))}</b></div>
    <div><span>Needs you</span><b class="num" style="color:${n.manual ? 'var(--manual)' : 'inherit'}">${A.fmt(n.manual)}</b></div><div><span>Failed or skipped</span><b class="num">${A.fmt(n.failed + n.skipped)}</b></div>
    <div><span>Today</span><b class="num">${A.fmt(c.today)} <small>/ ${c.daily_limit}</small></b></div>`;
}
function readyHTML(c) {
  const steps = [
    [!!senderOf(c), 'Sender profile', senderOf(c) ? `Sends as ${senderOf(c).label}` : 'Who the message is from', 'data-ctab="settings"', 'Choose'],
    [!!c.subject.trim() && c.message.trim().length >= 20, 'Subject and message', c.message.trim().length >= 20 ? 'Written' : 'What businesses will read', 'data-ctab="message"', 'Write'],
    [c.counts.total > 0, 'Leads', c.counts.total ? `${A.fmt(c.counts.total)} added` : 'Who to contact', 'data-o="addleads"', 'Add leads'],
  ];
  const done = steps.filter(x => x[0]).length, next = steps.findIndex(x => !x[0]);
  return `<div class="card rdy2"><div class="rdy2-h"><div><b>${done === 3 ? 'Ready to go' : 'Set up your campaign'}</b><span>${done === 3 ? 'Try a test run first: it fills real forms without sending.' : `${done} of 3 done`}</span></div><div class="rdy2-bar"><i style="width:${done / 3 * 100}%"></i></div></div>
    <div class="rdy2-steps">${steps.map(([ok, t, sub, act, lbl], i) => `<button class="rdy2-s ${ok ? 'ok' : ''} ${i === next ? 'next' : ''}" ${act}><i>${ok ? A.ic('check', 13) : i + 1}</i><span><b>${t}</b><small>${A.esc(sub)}</small></span>${ok ? '' : `<em>${lbl} ${A.ic('arrow', 12)}</em>`}</button>`).join('')}</div></div>`;
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
  return `<div class="oi oi-click" data-oid="${it.id}" data-lead="${it.lead_id}" data-camp="${it.campaign_id}" title="Show lead details and what was sent">
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
    <div style="grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:14px"><span class="help" id="s-save"></span><button class="btn ghost sm" data-o="delcamp" style="color:var(--bad)">${A.ic('trash', 13)}Delete campaign</button></div>
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
  const meta = document.querySelector('.chead .meta'); if (meta) meta.innerHTML = `${cpill(c)}${scheduled(c) ? `<span style="color:var(--info);font-weight:550">${startLbl(c)}</span>` : ''}<span>${senderOf(c) ? 'Sends as ' + A.esc(senderOf(c).label) : 'No sender yet'}</span><span>${c.daily_limit} a day</span><span>${schedLbl(c)}</span>`;
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
  const sk = s ? Object.entries({ already: 'already in this campaign', contacted: 'already contacted', dnc: 'do not contact', noWebsite: 'no website', profile: 'directory or social page instead of a website', noForm: 'no contact form' }).filter(([k]) => s.skipped[k]).map(([k, l]) => `${A.fmt(s.skipped[k])} ${l}`) : [];
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
const hasExt = () => !!document.documentElement.dataset.lhExt;
function b64url(str) { return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function fillUrl(it, c, snd, url, subject, message) {
  const payload = { v: 1, api: location.origin, oid: it.id, token: it.fill_token, ...(snd ? engineProfile(snd) : {}), subject, message, leadCompany: cleanCompanyName(it.name) };
  return url.replace(/#.*$/, '') + '#lh-fill=' + b64url(JSON.stringify(payload));
}
function extGuide() {
  A.$('#overlay').innerHTML = `<div class="scrim modal-scrim" data-act="close"><div class="modal" data-stop role="dialog" aria-label="Install the extension">
    <div class="card-h"><div><h2>Install the form filler</h2><p>Works in Opera, Chrome and Edge. Takes about two minutes, once.</p></div><button class="btn ghost sm" data-act="close" aria-label="Close">${A.ic('x')}</button></div>
    <div class="card-b"><ol class="extsteps">
      <li><a class="btn sm primary" href="/leadshunter-extension.zip" download>${A.ic('download', 13)}Download the extension</a> and unzip it.</li>
      <li>Open <code>opera://extensions</code> in a new tab (in Chrome: <code>chrome://extensions</code>).</li>
      <li>Turn on <b>Developer mode</b> (top right).</li>
      <li>Click <b>Load unpacked</b> and choose the <b>leadshunter-extension</b> folder that contains <code>manifest.json</code>.</li>
      <li>Come back here and reload the page. The button changes to <b>Fill form</b>.</li></ol>
      <p class="help" style="margin:12px 0 0">Updating: download again, replace the folder's files, then click the reload icon on the extension in <code>opera://extensions</code>. The extension only acts on pages you open with Fill form, and it never solves CAPTCHAs.</p></div>
    <div class="card-h" style="border-top:1px solid var(--line);border-bottom:0;justify-content:flex-end"><button class="btn" data-act="close">Done</button></div></div></div>`;
}
const MQ_REASONS = [['all', 'All'], ['captcha', 'CAPTCHA'], ['interrupted', 'Interrupted'], ['login-required', 'Login'], ['other', 'Other']];
const mqGroup = r => ['captcha', 'interrupted', 'login-required'].includes(r) ? r : 'other';
const ageLbl = t => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${Math.max(1, m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
const REASON_C = { captcha: 'var(--manual)', interrupted: 'var(--warn)', 'login-required': 'var(--info)', other: 'var(--idle)' };
const REASON_SHORT = { captcha: 'CAPTCHA', interrupted: 'Interrupted', 'login-required': 'Login', 'file-type': 'Word file', 'directory-page': 'Directory page' };
function mqFiltered() {
  const q = (MQ.q || '').trim().toLowerCase();
  return MQ.items.filter(it => (MQ.reason === 'all' || mqGroup(it.reason) === MQ.reason) && (!MQ.camp || it.campaign_id === MQ.camp) && (!q || `${it.name} ${it.website || ''}`.toLowerCase().includes(q)));
}
function manualView() {
  if (!MQ.loaded) { loadManual(); return loading(); }
  MQ.reason ||= 'all'; MQ.checked ||= new Set(); MQ.done ||= 0;
  const all = MQ.items;
  if (!all.length) return `${mqHead()}<div class="card"><div class="empty mqempty"><b>${MQ.done ? `All done. ${MQ.done} handled this session.` : 'All clear'}</b>Nothing needs you right now. Forms with a CAPTCHA to solve, and anything the robot couldn't finish, land here.</div></div>`;
  return `${mqHead()}
    <div class="card mqbar">
      <div class="tabs">${MQ_REASONS.map(([k, l]) => { const n = k === 'all' ? all.length : all.filter(i => mqGroup(i.reason) === k).length; return n || k === 'all' ? `<button class="${MQ.reason === k ? 'on' : ''}" data-mqreason="${k}">${l}<span class="n">${A.fmt(n)}</span></button>` : ''; }).join('')}</div>
      <select class="input mqcamp" id="mq-camp"><option value="0">All campaigns</option>${[...new Map(all.map(i => [i.campaign_id, i.campaign])).entries()].map(([id, n]) => `<option value="${id}" ${MQ.camp === id ? 'selected' : ''}>${A.esc(n)}</option>`).join('')}</select>
      <div class="lsearch mqsearch">${A.ic('find', 15)}<input id="mq-q" placeholder="Search business or website" value="${A.esc(MQ.q || '')}" autocomplete="off"></div>
    </div>
    <div id="mq-bulk">${mqBulkHTML()}</div>
    <div class="mqgrid"><div class="card mqlist" id="mq-list">${mqList()}</div><div class="card mqwork" id="mq-detail">${mqDetail()}</div></div>`;
}
function mqHead() {
  return `<div class="head"><div><div class="eyebrow">Outreach</div><h1>Manual queue</h1><p>${MQ.items.length ? `<b class="num">${A.fmt(MQ.items.length)}</b> form${MQ.items.length === 1 ? '' : 's'} need you.` : ''} Forms with a CAPTCHA to solve, plus anything the robot couldn't finish.${MQ.done ? ` <span class="okline">${A.ic('check', 12)}${MQ.done} done this session</span>` : ''}</p></div>
    <div class="row">${hasExt() ? `<span class="extok">${A.ic('check', 13)}Form filler installed</span>` : `<button class="btn primary" data-o="extguide">${A.ic('download', 14)}Get the form filler</button>`}</div></div>`;
}
function mqBulkHTML() {
  const n = MQ.checked ? MQ.checked.size : 0;
  if (!n) return '';
  return `<div class="selbar mqsel"><b class="num">${A.fmt(n)} selected</b><button class="linkbtn" data-mqbulk="all">Select all ${A.fmt(mqFiltered().length)} shown</button><button class="linkbtn" data-mqbulk="none">Clear</button>
    <div class="selacts"><button class="btn sm" data-mqbulk="retry" title="Send back to the robot: it sends the ones without a CAPTCHA to solve">${A.ic('retry', 14)}Try robot again</button><button class="btn sm ghost" data-mqbulk="sent">${A.ic('check', 14)}Mark sent</button><button class="btn sm ghost" data-mqbulk="skip">${A.ic('x', 14)}Skip</button></div></div>`;
}
function mqList() {
  const list = mqFiltered();
  if (!list.length) return `<div class="empty"><b>Nothing matches</b>Try another filter.</div>`;
  const sel = MQ.items[MQ.sel];
  if (!sel || !list.includes(sel)) MQ.sel = MQ.items.indexOf(list[0]);
  return list.slice(0, MQ.limit || 300).map(it => { const i = MQ.items.indexOf(it), g = mqGroup(it.reason);
    return `<div class="mqrow ${i === MQ.sel ? 'on' : ''}" data-mq="${i}"><span class="cb ${MQ.checked.has(it.id) ? 'on' : ''}" data-mqchk="${it.id}" role="checkbox" aria-checked="${MQ.checked.has(it.id)}" aria-label="Select"></span>
      <div class="mqrow-b"><b>${A.esc(cleanCompanyName(it.name))}</b><span>${A.esc(domain(it.website))} · ${A.esc(it.campaign)}</span></div>
      <div class="mqrow-r"><span class="pill" style="--c:${REASON_C[g]}">${REASON_SHORT[it.reason] || 'Other'}</span><small class="num">${ageLbl(it.updated_at)}</small></div></div>`; }).join('')
    + (list.length > (MQ.limit || 300) ? `<button class="btn ghost sm mqmore" data-mqbulk="more">Show ${A.fmt(Math.min(300, list.length - (MQ.limit || 300)))} more</button>` : '');
}
function mqDetail() {
  const it = MQ.items[MQ.sel]; if (!it || !mqFiltered().includes(it)) return `<div class="empty">Pick a form on the left.</div>`;
  const c = OS.campaigns.find(x => x.id === it.campaign_id), snd = c && senderOf(c), lead = leadFor(it);
  const subj = c ? personalize(c.subject, lead) : '', msg = c ? personalize(c.message, lead) : '';
  const url = it.form_url || it.website;
  const list = mqFiltered(), pos = list.indexOf(it);
  const canFill = hasExt() && it.fill_token && snd && subj && msg && url && it.reason !== 'login-required';
  const f = (k, v) => v ? `<div class="mfield"><span class="k">${k}</span><span class="val">${A.esc(v)}</span><button class="dcopy" data-copy="${A.esc(v)}">${A.ic('copy', 12)}<span>Copy</span></button></div>` : '';
  const why = it.reason === 'captcha' ? 'This form has a CAPTCHA you need to solve. Everything else is filled in for you.' : it.reason === 'interrupted' ? 'The robot stopped while sending this one. Open the form and check whether it went through before sending again.' : reasonText(it.reason);
  return `<div class="mqw-h"><div><h2>${A.esc(cleanCompanyName(it.name))}</h2><p>${url ? `<a href="${A.esc(url)}" target="_blank" rel="noopener">${A.esc(domain(url))}</a> · ` : ''}${A.esc(it.campaign)}</p></div><div class="mqw-nav"><button class="iconbtn sm" data-mqnav="-1" aria-label="Previous" ${pos <= 0 ? 'disabled' : ''}>${A.ic('back', 14)}</button><span class="num">${pos + 1} / ${list.length}</span><button class="iconbtn sm" data-mqnav="1" aria-label="Next" ${pos >= list.length - 1 ? 'disabled' : ''}>${A.ic('arrow', 14)}</button></div></div>
    <div class="mqw-b">
      <div class="note ${it.reason === 'interrupted' ? '' : 'neutral'}">${A.ic('alert')}<div>${A.esc(why)}</div></div>
      ${canFill ? `<a class="btn primary mqopen" href="${A.esc(fillUrl(it, c, snd, url, subj, msg))}" target="_blank" rel="noopener" data-mqopened>${A.ic('edit', 15)}Fill form<span class="kbd2">F</span></a>
          <ol class="mqsteps"><li>The form opens already filled in</li><li>${it.reason === 'interrupted' ? 'Check it wasn’t already sent, then press send' : it.reason === 'captcha' ? 'Solve the CAPTCHA and press send' : 'Check the fields and press send'}</li><li>It's marked sent here automatically</li></ol>`
        : url ? `<a class="btn primary mqopen" href="${A.esc(url)}" target="_blank" rel="noopener" data-mqopened>${A.ic('ext', 15)}Open the form<span class="kbd2">F</span></a>${hasExt() ? '' : `<div class="extcta">${A.ic('edit', 16)}<div><b>Skip the copy-paste</b><span>With the form filler extension, forms open already filled in and are marked sent automatically.</span></div><button class="btn sm" data-o="extguide">Get it</button></div>`}` : ''}
      <details class="mqfields" ${canFill ? '' : 'open'}><summary>${canFill ? 'Copy fields by hand instead' : 'Fields to paste'}</summary><div>${f('Subject', subj)}${f('Message', msg)}${snd ? f('First name', snd.first_name) + f('Last name', snd.last_name) + f('Email', snd.email) + f('Phone', snd.phone) + f('Company', snd.company) + f('Website', snd.website) : ''}</div></details>
    </div>
    <div class="mqw-f"><button class="btn primary" data-mqact="sent">${A.ic('check', 14)}Mark as sent<span class="kbd2">S</span></button><button class="btn" data-mqact="retry" title="Send back to the robot">${A.ic('retry', 14)}Try robot<span class="kbd2">R</span></button><button class="btn" data-mqact="skip">Skip<span class="kbd2">X</span></button><button class="btn ghost" data-mqact="dnc" style="margin-left:auto;color:var(--bad)">${A.ic('shield', 14)}Do not contact</button></div>`;
}
function mqRender(parts = ['list', 'detail', 'bulk']) {
  if (parts.includes('list')) { const el = A.$('#mq-list'); if (el) el.innerHTML = mqList(); }
  if (parts.includes('detail')) { const el = A.$('#mq-detail'); if (el) el.innerHTML = mqDetail(); }
  if (parts.includes('bulk')) { const el = A.$('#mq-bulk'); if (el) el.innerHTML = mqBulkHTML(); }
  document.querySelector('#mq-list .on')?.scrollIntoView({ block: 'nearest' });
}
function mqMove(step) {
  const list = mqFiltered(), pos = list.indexOf(MQ.items[MQ.sel]);
  const next = list[Math.max(0, Math.min(list.length - 1, pos + step))];
  if (next) { MQ.sel = MQ.items.indexOf(next); mqRender(['list', 'detail']); }
}
async function loadManual() {
  if (MQ.loading) return; MQ.loading = true;
  try {
    await loadOutreach();   // fresh campaigns and senders: the Fill form link carries them
    const r = await A.api('GET', '/api/outreach/items?status=manual&order=recent&limit=500&tokens=1');
    const cur = MQ.items[MQ.sel]?.id;
    MQ.items = r.items; MQ.loaded = true;
    const keep = MQ.items.findIndex(i => i.id === cur); MQ.sel = keep >= 0 ? keep : Math.min(MQ.sel || 0, Math.max(0, MQ.items.length - 1));
    if (MQ.checked) for (const id of [...MQ.checked]) if (!MQ.items.some(i => i.id === id)) MQ.checked.delete(id);
    if (A.currentView() === 'manual') A.render();
  } catch (e) { A.toast(e.message, 'alert'); } finally { MQ.loading = false; }
}
async function mqAction(act) {
  const it = MQ.items[MQ.sel]; if (!it) return;
  const list = mqFiltered(), pos = list.indexOf(it);
  try {
    await A.api('POST', `/api/outreach/${it.id}`, { action: act });
    MQ.items.splice(MQ.sel, 1); MQ.checked?.delete(it.id); MQ.done = (MQ.done || 0) + 1;
    const rest = list.filter(x => x !== it), next = rest[Math.min(pos, rest.length - 1)];
    MQ.sel = next ? MQ.items.indexOf(next) : 0;
    OS.manual = Math.max(0, OS.manual - 1); A.renderNav('manual');
    A.toast({ sent: 'Marked as sent', retry: 'Sent back to the robot', skip: 'Skipped', dnc: 'Marked do not contact' }[act]);
    if (!MQ.items.length) A.render(); else { mqRender(); const h = document.querySelector('.head p'); if (h) h.outerHTML = mqHead().match(/<p>[\s\S]*?<\/p>/)[0]; }
    A.sync();
  } catch (e) { A.toast(e.message, 'alert'); }
}
async function mqBulk(act) {
  const ids = [...MQ.checked]; if (!ids.length) return;
  const label = { retry: 'Sent back to the robot', sent: 'Marked as sent', skip: 'Skipped' }[act];
  let done = 0;
  for (let i = 0; i < ids.length; i += 100) { const r = await A.api('POST', '/api/outreach/bulk', { ids: ids.slice(i, i + 100), action: act }).catch(e => { A.toast(e.message, 'alert'); return null; }); if (r) done += r.done; }
  MQ.checked.clear(); MQ.done = (MQ.done || 0) + done;
  A.toast(`${label}: ${A.fmt(done)}`);
  await loadManual(); A.sync();
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
  const chk = t.closest('[data-mqchk]');
  if (chk) { const id = +chk.dataset.mqchk; MQ.checked.has(id) ? MQ.checked.delete(id) : MQ.checked.add(id); mqRender(['list', 'bulk']); return; }
  const mqr = t.closest('[data-mqreason]');
  if (mqr) { MQ.reason = mqr.dataset.mqreason; A.render(); return; }
  const mqb = t.closest('[data-mqbulk]');
  if (mqb) { const a = mqb.dataset.mqbulk; if (a === 'all') { mqFiltered().forEach(i => MQ.checked.add(i.id)); mqRender(['list', 'bulk']); } else if (a === 'none') { MQ.checked.clear(); mqRender(['list', 'bulk']); } else if (a === 'more') { MQ.limit = (MQ.limit || 300) + 300; mqRender(['list']); } else { mqb.disabled = true; mqBulk(a); } return; }
  const mqn = t.closest('[data-mqnav]');
  if (mqn) { mqMove(+mqn.dataset.mqnav); return; }
  const mq = t.closest('[data-mq]');
  if (mq) { MQ.sel = +mq.dataset.mq; mqRender(['list', 'detail']); return; }
  const mqa = t.closest('[data-mqact]');
  if (mqa) { mqAction(mqa.dataset.mqact); return; }
  const msr = t.closest('[data-msres]');
  if (msr) { MS.result = msr.dataset.msres; MS.loaded = false; loadMessages(); return; }
  const row = t.closest('.oi-click');
  if (row && !t.closest('a,button,.menu')) { openFor = +row.dataset.camp; A.openLead(+row.dataset.lead); return; }
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
    case 'start': startModal(c); break;
    case 'startok': {
      const later = A.$('#st-later')?.checked; let start_at = null;
      if (later) { start_at = ptToMs(A.$('#st-date').value, A.$('#st-time').value); if (!start_at || start_at < Date.now()) { A.$('#st-err').textContent = 'Pick a date and time in the future.'; return; } }
      b.disabled = true;
      try { const r = await A.api('POST', `/api/campaigns/${c.id}/status`, { status: 'active', start_at }); upsertCampaign(r.campaign); A.closeOverlay(); A.render();
        A.toast(scheduled(r.campaign) ? `Scheduled. ${startLbl(r.campaign)}.` : inWindowNow(r.campaign) ? 'Campaign started. The first batch is on its way.' : `Campaign started. Sending begins ${nextWindowLbl(r.campaign)}.`); refreshCampaign(c.id).catch(() => {}); }
      catch (err) { A.$('#st-err').textContent = err.message; b.disabled = false; }
      break;
    }
    case 'pause': {
      b.disabled = true;
      try { const r = await A.api('POST', `/api/campaigns/${c.id}/status`, { status: 'paused' }); upsertCampaign(r.campaign); A.render(); A.toast('Paused. Nothing more will be sent.'); }
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
    case 'delcamp': {
      const n = c.counts, sent = contacted(c), waiting = n.queued + n.sending + n.manual + n.failed;  // skipped leads already have their own status
      A.$('#overlay').innerHTML = `<div class="scrim modal-scrim" data-act="close"><div class="modal" data-stop role="dialog" aria-label="Delete campaign">
        <div class="card-h"><div><h2>Delete “${A.esc(c.name)}”?</h2><p>This can't be undone.</p></div><button class="btn ghost sm" data-act="close" aria-label="Close">${A.ic('x')}</button></div>
        <div class="card-b" style="display:flex;flex-direction:column;gap:12px">
          <ul class="delsum">
            <li>The campaign, its message and its results are removed${jobActive(c.job) ? ', and the queued batch is cancelled' : ''}.</li>
            ${sent ? `<li><b>${A.fmt(sent)}</b> lead${sent === 1 ? '' : 's'} already contacted stay marked <b>Contacted</b>, so they won't be messaged twice.</li>` : ''}
            ${waiting ? `<li><b>${A.fmt(waiting)}</b> lead${waiting === 1 ? '' : 's'} not contacted go back to <b>New</b> (unless another campaign has them).</li>` : ''}
            <li>Your leads themselves are not deleted.</li></ul>
          <div class="field"><label for="del-in">Type <b>DELETE</b> to confirm</label><input class="input big" id="del-in" autocomplete="off" spellcheck="false" placeholder="DELETE"></div>
          <div class="help" id="del-err" style="color:var(--bad)"></div></div>
        <div class="card-h" style="border-top:1px solid var(--line);border-bottom:0;justify-content:flex-end"><button class="btn" data-act="close">Cancel</button><button class="btn primary danger-btn" data-o="delcampok" disabled>${A.ic('trash', 14)}Delete campaign</button></div></div></div>`;
      setTimeout(() => A.$('#del-in')?.focus(), 0);
      break;
    }
    case 'delcampok': {
      if (A.$('#del-in').value.trim() !== 'DELETE') return;
      b.disabled = true;
      try { await A.api('DELETE', `/api/campaigns/${c.id}`, { confirm: 'DELETE' }); OS.campaigns = OS.campaigns.filter(x => x.id !== c.id); delete CP[c.id]; A.closeOverlay(); location.hash = '#campaigns'; A.toast('Campaign deleted'); A.sync(); loadOutreach(); }
      catch (err) { A.$('#del-err').textContent = err.message; b.disabled = false; }
      break;
    }
    case 'dismissbanner': A.$('#c-banner').innerHTML = ''; break;
    case 'moreitems': loadItems(c.id, true); break;
    case 'extguide': extGuide(); break;
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
/** Date + time typed in Los Angeles time → timestamp. */
function ptToMs(date, time) {
  if (!date || !time) return null;
  const [y, mo, d] = date.split('-').map(Number), [h, mi] = time.split(':').map(Number);
  let t = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
    t += Date.UTC(y, mo - 1, d, h, mi) - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  }
  return t;
}
function startModal(c) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
  const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(Date.now() + 864e5));
  const times = []; for (let h = 0; h < 24; h++) for (const m of [0, 30]) times.push(`${String(h).padStart(2, '0')}:${m ? '30' : '00'}`);
  const tl = t => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  A.$('#overlay').innerHTML = `<div class="scrim modal-scrim" data-act="close"><div class="modal" data-stop role="dialog" aria-label="Start campaign">
    <div class="card-h"><div><h2>Start “${A.esc(c.name)}”</h2><p>Sends up to ${c.daily_limit} a day, ${schedLbl(c)}. All times are Los Angeles time.</p></div><button class="btn ghost sm" data-act="close" aria-label="Close">${A.ic('x')}</button></div>
    <div class="card-b" style="display:flex;flex-direction:column;gap:10px">
      <label class="opt on" id="st-o1"><input type="radio" name="stwhen" id="st-now" checked><div><b>Start now</b><span>${inWindowNow(c) ? 'The first batch goes out within a few minutes.' : `It's outside your sending hours, so sending begins ${nextWindowLbl(c)}.`}</span></div></label>
      <label class="opt" id="st-o2"><input type="radio" name="stwhen" id="st-later"><div style="flex:1"><b>Schedule a start</b><span>Nothing is sent before this time.</span>
        <div class="row st-pick" style="margin-top:8px;flex-wrap:nowrap"><input class="input" type="date" id="st-date" min="${today}" value="${tomorrow}"><select class="input" id="st-time">${times.map(t => `<option value="${t}" ${t === `${String(c.window_start).padStart(2, '0')}:00` ? 'selected' : ''}>${tl(t)}</option>`).join('')}</select><span class="help" style="white-space:nowrap">PT</span></div></div></label>
      <div class="help" id="st-err" style="color:var(--bad)"></div></div>
    <div class="card-h" style="border-top:1px solid var(--line);border-bottom:0;justify-content:flex-end"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-o="startok">${A.ic('play', 13)}<span id="st-go">Start campaign</span></button></div></div></div>`;
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
  if (t.id === 'mq-q') { MQ.q = t.value; mqRender(['list', 'detail']); return; }
  if (t.id === 'del-in') { const ok = t.value.trim() === 'DELETE'; const bt = document.querySelector('[data-o="delcampok"]'); if (bt) bt.disabled = !ok; return; }
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
  if (t.name === 'stwhen' || t.id === 'st-date' || t.id === 'st-time') { if (t.id === 'st-date' || t.id === 'st-time') A.$('#st-later').checked = true; const later = A.$('#st-later').checked; A.$('#st-o1').classList.toggle('on', !later); A.$('#st-o2').classList.toggle('on', later); A.$('#st-go').textContent = later ? 'Schedule campaign' : 'Start campaign'; return; }
  if (t.id === 'ac-inc') { AC.includeContacted = t.checked; acSummary(); return; }
  if (t.id === 'ms-camp') { MS.campaign = +t.value; MS.loaded = false; loadMessages(); return; }
  if (t.id === 'mq-camp') { MQ.camp = +t.value || 0; mqRender(['list', 'detail']); return; }
}
function onKey(e) {
  if (e.target.id === 'del-in' && e.key === 'Enter') { e.preventDefault(); document.querySelector('[data-o="delcampok"]:not([disabled])')?.click(); return; }
  if (A.currentView() !== 'manual' || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || document.querySelector('.scrim') || e.metaKey || e.ctrlKey) return;
  const k = e.key.toLowerCase();
  if (k === 'j' || e.key === 'ArrowDown') { e.preventDefault(); mqMove(1); }
  else if (k === 'k' || e.key === 'ArrowUp') { e.preventDefault(); mqMove(-1); }
  else if (k === 's') { e.preventDefault(); mqAction('sent'); }
  else if (k === 'r') { e.preventDefault(); mqAction('retry'); }
  else if (k === 'x') { e.preventDefault(); mqAction('skip'); }
  else if (k === 'f') { const a = document.querySelector('a.mqopen'); if (a) { e.preventDefault(); window.open(a.href, '_blank', 'noopener'); } }
}

/* ------------------------------------------------------------------ lead panel: campaign history */
let openFor = null;   // campaign to expand when the lead panel opens from a campaign
export async function leadOutreachInto(el, L) {
  if (!el) return;
  const expand = openFor; openFor = null;
  try {
    const r = await A.api('GET', `/api/leads/${L.id}/outreach`);
    if (!document.body.contains(el)) return;
    if (!r.items.length) { el.innerHTML = ''; return; }
    const ind = A.ST.industries.find(d => d.id === L.industry_id);
    const lead = { name: L.name, city: L.city, state: L.region, industry: ind ? ind.name : '' };
    el.innerHTML = `<div class="ldout">${L.status === 1 ? `<span class="help">In a campaign. This is set automatically.</span>` : ''}${r.items.map(it => {
      const why = it.status === 'sent' ? it.evidence : it.status === 'submitted' ? reasonText(it.reason || 'sent-no-confirmation') : reasonText(it.reason);
      const sentOrWill = SENT.includes(it.status) ? 'Message sent' : it.status === 'queued' || it.status === 'sending' ? 'Message that will be sent' : 'Message';
      const answers = (it.answers || '').split(' · ').filter(Boolean);
      const when = (lbl, t) => t ? `<div class="dk"><dt>${lbl}</dt><dd>${A.esc(A.whenPT(t))}</dd></div>` : '';
      return `<details class="ldo" ${expand === it.campaign_id || r.items.length === 1 ? 'open' : ''}><summary><div><b>${A.esc(it.campaign)}</b>${why ? `<small>${A.esc(why)}</small>` : ''}</div><div class="ldo-r">${pill(it.status)}<small class="num">${A.esc(A.whenPT(it.sent_at || it.updated_at).replace(' PT', ''))}</small></div></summary>
        <div class="ldo-b">
          <dl class="ld-dl">${when('Added', it.created_at)}${it.test_status ? `<div class="dk"><dt>Test run</dt><dd>${it.test_status === 'ready' ? 'Ready to send' : A.esc(reasonText(it.test_reason) || it.test_status)}</dd></div>` : ''}${when(it.status === 'sent_manual' ? 'Sent by you' : 'Sent', it.sent_at)}
            ${it.evidence && it.status !== 'queued' ? `<div class="dk"><dt>Site replied</dt><dd>“${A.esc(it.evidence)}”</dd></div>` : ''}
            ${it.form_url ? `<div class="dk"><dt>Form</dt><dd><a href="${A.esc(it.form_url)}" target="_blank" rel="noopener">${A.esc(domain(it.form_url))}${A.esc((() => { try { return new URL(it.form_url).pathname.replace(/\/$/, ''); } catch { return ''; } })())}</a></dd></div>` : ''}</dl>
          <div class="ldo-msg"><h6>${sentOrWill}</h6><b>${A.esc(personalize(it.subject, lead))}</b><p>${A.esc(personalize(it.message, lead))}</p></div>
          ${answers.length ? `<div class="ldo-ans"><h6>Other answers the robot gave</h6><ul>${answers.map(a => { const i = a.indexOf(': '); return `<li><span>${A.esc(i > 0 ? a.slice(0, i) : 'Field')}</span><b>${A.esc(i > 0 ? a.slice(i + 2) : a)}</b></li>`; }).join('')}</ul></div>` : ''}
          <a class="linkbtn muted" href="#campaign/${it.campaign_id}">Open campaign</a>
        </div></details>`;
    }).join('')}</div>`;
  } catch { el.innerHTML = ''; }
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
  document.addEventListener('lh-ext-ready', () => { if (A.currentView() === 'manual' && MQ.loaded) A.render(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && A.currentView() === 'manual' && MQ.loaded && !MQ.fresh) { MQ.fresh = true; loadManual().then(() => { MQ.fresh = false; }); loadOutreach(); } });
  window.addEventListener('beforeunload', () => { if (pendingSave) navigator.sendBeacon && flushSave(); });
}
export const outreachNav = () => [['campaigns', 'Campaigns', 'campaigns'], ['manual', 'Manual queue', 'manual', OS.manual], ['messages', 'Messages', 'messages'], ['senders', 'Sender profiles', 'senders']];
