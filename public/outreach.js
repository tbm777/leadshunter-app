// LeadsHunter outreach pages: campaigns, manual queue, messages, sender profiles. Plugs into app.js through install().
import { personalize, cleanCompanyName, MERGE_TAGS, unknownTags } from './shared/personalize.js';
import { render as renderFile, ASSETS } from './shared/templates/bat-marketing.js';
import { SENDER_FALLBACKS, OTHER_FIELDS, engineProfile, localizeProfile } from './shared/fallbacks.js';

let A;                       // helpers from app.js
const OS = { loaded: false, senders: [], campaigns: [], manual: 0 };
const CP = {};               // campaign page state, per open campaign
const MQ = { items: [], sel: 0, loading: false };
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
  'skipped by you': 'Skipped by you', 'do not contact': 'Marked do not contact', 'already contacted': 'You marked this lead as contacted', 'directory-page': 'The website is a directory or social profile, not their own site', manual: 'Manual campaign: you send this one yourself', 'no-contact-form': 'No contact form found',
};
const SENT = ['sent', 'submitted', 'sent_manual'];
const reasonText = r => REASON[r] || (r ? String(r).replace(/-/g, ' ') : '');
const pill = (st) => `<span class="pill" style="--c:${ST_COLOR[st] || 'var(--idle)'}">${ST_LABEL[st] || st}</span>`;
const CSTATUS = { draft: ['Draft', 'var(--idle)'], active: ['Active', 'var(--ok)'], paused: ['Paused', 'var(--warn)'], archived: ['Archived', 'var(--idle)'] };
const scheduled = c => c.status === 'active' && c.mode !== 'manual' && c.start_at && c.start_at > Date.now();
const modePill = c => c.mode === 'manual' ? '<span class="pill plain modepill">Manual</span>' : '';
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
    <div><h4>${A.esc(c.name)}</h4><div class="meta">${cpill(c)}${modePill(c)}${scheduled(c) ? `<span style="color:var(--info)">${startLbl(c)}</span>` : ''}<span>${s ? A.esc(s.label) : '<span style="color:var(--warn)">No sender</span>'}</span>${c.mode === 'manual' ? '<span>You send from the Manual queue</span>' : `<span>${c.daily_limit}/day</span><span>${schedLbl(c)}</span>`}</div></div>
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
function modeOpts(cur, name) {
  return `<div class="modeopts">${[['auto', 'Automatic', 'The robot fills and sends each form. CAPTCHAs come to your Manual queue.'], ['manual', 'Manual', 'Every form goes to your Manual queue. You send each one with Fill form.']].map(([v, t, d]) => `<label class="opt sm ${cur === v ? 'on' : ''}"><input type="radio" name="${name}" value="${v}" ${cur === v ? 'checked' : ''}><div><b>${t}</b><span>${d}</span></div></label>`).join('')}</div>`;
}
function newCampaignModal(then) {
  A.$('#overlay').innerHTML = `<div class="scrim modal-scrim" data-act="close"><div class="modal" data-stop role="dialog" aria-label="New campaign">
    <div class="card-h"><div><h2>New campaign</h2><p>You can change everything later.</p></div><button class="btn ghost sm" data-act="close" aria-label="Close">${A.ic('x')}</button></div>
    <div class="card-b" style="display:flex;flex-direction:column;gap:14px">
      <div class="field"><label for="nc-name">Name</label><input class="input big" id="nc-name" placeholder="e.g. Roofers, missed calls" autocomplete="off"></div>
      <div class="field"><label for="nc-sender">Send as</label>${OS.senders.length ? `<select class="input" id="nc-sender">${OS.senders.map(s => `<option value="${s.id}">${A.esc(s.label)} · ${A.esc(s.email)}</option>`).join('')}</select>` : `<div class="help">No sender profile yet. You can add one in Settings after creating the campaign.</div>`}</div>
      <div class="field"><span class="flabel">How it sends</span>${modeOpts('auto', 'ncmode')}</div>
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
    const r = await A.api('POST', '/api/campaigns', { name, sender_id: A.$('#nc-sender') ? +A.$('#nc-sender').value : null, subject: DEFAULT_SUBJECT, message: '', mode: document.querySelector('[name="ncmode"]:checked')?.value || 'auto' });
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
      <div><a class="back" href="#campaigns">${A.ic('back', 14)}Campaigns</a><h1>${A.esc(c.name)}</h1><div class="meta">${cmeta(c)}</div></div>
      <div class="row" id="c-actions">${actionsHTML(c)}</div></div>
    <div id="c-banner">${bannerHTML(c)}</div>
    ${c.status === 'draft' ? `<div id="c-ready">${readyHTML(c)}</div>` : ''}
    <div class="card ministats ostats" id="c-stats">${statsHTML(c)}</div>
    <div class="ctabs" role="tablist">${[['leads', 'Leads', c.counts.total], ['message', c.steps && c.steps.length ? `Sequence <span class="n num">${c.steps.length + 1} steps</span>` : 'Sequence'], ['settings', 'Settings']].map(([k, l, n]) => `<button role="tab" aria-selected="${P.tab === k}" class="${P.tab === k ? 'on' : ''}" data-ctab="${k}">${l}${n != null ? ` <span class="n num">${A.fmt(n)}</span>` : ''}</button>`).join('')}</div>
    <div id="c-tab">${tabHTML(c)}</div>`;
}
function cmeta(c) {
  return `${cpill(c)}${modePill(c)}${scheduled(c) ? `<span style="color:var(--info);font-weight:550">${startLbl(c)}</span>` : ''}<span>${senderOf(c) ? 'Sends as ' + A.esc(senderOf(c).label) : 'No sender yet'}</span>${c.mode === 'manual' ? '<span>You send each form from the Manual queue</span>' : `<span>${c.daily_limit} a day</span><span>${schedLbl(c)}</span>`}`;
}
function actionsHTML(c) {
  if (c.mode === 'manual') {
    return `${c.status === 'active' ? `<a class="btn" href="#manual" data-o="toqueue">${A.ic('manual', 14)}Open Manual queue${c.counts.manual ? ` <span class="n num">${A.fmt(c.counts.manual)}</span>` : ''}</a><button class="btn" data-o="pause">Pause</button>` : `<button class="btn primary" data-o="launchmanual">${A.ic('play', 13)}${c.status === 'paused' ? 'Resume' : 'Launch campaign'}</button>`}`;
  }
  const live = jobActive(c.job), left = Math.max(0, c.daily_limit - c.today), canTest = !live && c.counts.queued > 0;
  // Only show what can be used right now: no greyed-out buttons.
  if (c.status === 'active') {
    if (scheduled(c)) return `<button class="btn" data-o="pause">Cancel schedule</button>`;
    const items = [canTest && left ? ['sendnow', A.ic('campaigns', 14), 'Send next batch now', `Up to ${Math.min(40, left, c.counts.queued)} forms, outside the schedule`] : null,
      canTest ? ['test', A.ic('check', 14), 'Test run', 'Fills up to 10 forms without sending'] : null].filter(Boolean);
    return `${items.length ? `<div class="kebab cmenu"><button class="iconbtn" data-o="cmenu" aria-label="More actions" aria-haspopup="menu">⋯</button>${CMENU.open ? `<div class="menu" role="menu">${items.map(([a, ic, t, d]) => `<button role="menuitem" data-o="${a}">${ic}<span><b>${t}</b><small>${d}</small></span></button>`).join('')}</div>` : ''}</div>` : ''}<button class="btn" data-o="pause">Pause</button>`;
  }
  return `${canTest ? `<button class="btn" data-o="test" title="Fills up to 10 forms and stops before pressing send">${A.ic('check', 14)}Test run</button>` : ''}<button class="btn primary" data-o="start">${A.ic('play', 13)}${c.status === 'paused' ? 'Resume' : 'Start campaign'}</button>`;
}
const CMENU = { open: false };
function statsHTML(c) {
  const n = c.counts;
  return `<div><span>Queued</span><b class="num">${A.fmt(n.queued + n.sending)}</b></div><div><span>Sent</span><b class="num" style="color:var(--ok)">${A.fmt(contacted(c))}</b>${n.submitted ? `<button class="linkbtn muted" data-o="reviewnoconf" style="font-size:11.5px;text-align:left">${A.fmt(n.submitted)} without confirmation · Review</button>` : ''}</div>
    <div><span>Needs you</span><b class="num" style="color:${n.manual ? 'var(--manual)' : 'inherit'}">${A.fmt(n.manual)}</b></div>${(c.steps || []).length ? `<div><span>Replied</span><b class="num" style="color:var(--manual)">${A.fmt(n.replied || 0)}</b>${n.scheduled ? `<small class="help">${A.fmt(n.scheduled)} follow-up${n.scheduled === 1 ? '' : 's'} scheduled</small>` : ''}</div>` : ''}<div><span>Failed or skipped</span><b class="num">${A.fmt(n.failed + n.skipped)}</b></div>
    <div><span>Today</span><b class="num">${A.fmt(c.today)}${c.mode === 'manual' ? '' : ` <small>/ ${c.daily_limit}</small>`}</b></div>`;
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
    return `<div class="jbanner ok">${A.ic('check', 16)}<div><b>Test run finished: ${ready} ready${man ? `, ${man} need you` : ''}${bad ? `, ${bad} failed` : ''}</b><span>Nothing was sent. Check what the robot did: it takes about 20 seconds per form and makes the engine more accurate.</span></div><button class="btn sm" data-o="testreview">Review results</button><button class="btn ghost sm" data-o="dismissbanner">Dismiss</button></div>`;
  }
  return '';
}
function tabHTML(c) {
  const P = cp(c.id);
  if (P.tab === 'message') return sequenceTab(c);
  if (P.tab === 'settings') return settingsTab(c);
  return leadsTab(c);
}

/* leads tab */
const FILTERS = [['all', 'All', null], ['queued', 'Queued', 'queued,sending'], ['sent', 'Sent', 'sent,submitted,sent_manual'], ['noconf', 'No confirmation', 'submitted'], ['manual', 'Needs you', 'manual'], ['failed', 'Failed', 'failed'], ['skipped', 'Skipped', 'skipped']];
function leadsTab(c) {
  const P = cp(c.id), n = c.counts;
  const cnt = { all: n.total, queued: n.queued + n.sending, sent: contacted(c), noconf: n.submitted, manual: n.manual, failed: n.failed, skipped: n.skipped };
  if (!n.total) return `<div class="card"><div class="empty"><b>No leads in this campaign yet</b>Go to Leads, select the businesses you want, then choose “Add to campaign”.<div style="margin-top:14px"><button class="btn primary" data-o="addleads">${A.ic('leads', 14)}Pick leads</button></div></div></div>`;
  return `<div class="card">
    <div class="card-h ofilters"><div class="tabs">${FILTERS.filter(([k]) => k !== 'noconf' || cnt.noconf).map(([k, l]) => `<button class="${P.filter === k ? 'on' : ''}" data-ofilter="${k}">${l}<span class="n">${A.fmt(cnt[k])}</span></button>`).join('')}</div><button class="btn ghost sm" data-o="addleads">${A.ic('plus', 13)}Add leads</button></div>
    <div id="c-items">${itemsHTML(c)}</div></div>
    ${(c.counts.to_review || 0) ? `<div class="rvbar">${A.ic('check', 14)}<span><b class="num">${A.fmt(c.counts.to_review)}</b> test result${c.counts.to_review === 1 ? '' : 's'} waiting for your check</span><button class="btn sm" data-o="testreview">Review now</button></div>` : ''}`;
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
  const cc = OS.campaigns.find(x => x.id === it.campaign_id), total = 1 + ((cc && cc.steps) || []).length;
  const seq = total > 1 && SENT.concat('manual', 'sending').includes(it.status) ? (it.lead_status === 4 ? '<small class="seqp rep">Replied · sequence stopped</small>' : it.next_at ? `<small class="seqp">Step ${it.step} of ${total} next · ${A.esc(A.whenPT(it.next_at).replace(' PT', ''))}</small>` : it.step >= total && SENT.includes(it.status) ? `<small class="seqp done">All ${total} steps done</small>` : it.step > 1 ? `<small class="seqp">Step ${it.step} of ${total}</small>` : '') : '';
  return `<div class="oi oi-click" data-oid="${it.id}" data-olead="${it.lead_id}" data-camp="${it.campaign_id}" title="Show lead details and what was sent">
    <div class="oi-b"><b>${A.esc(it.name)}</b><span>${A.esc(domain(it.website))}${withCampaign ? ` · ${A.esc(it.campaign)}` : ''}</span></div>
    <div class="oi-r">${pill(it.status)}${reason ? `<small title="${A.esc(reason)}">${A.esc(reason)}</small>` : ''}${seq}</div>
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
  if (SENT.concat('manual').includes(it.status) && it.lead_status !== 4) acts.push(['replied', A.ic('messages', 14) + 'Mark replied (stops follow-ups)']);
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
  const subj = (A.$('#m-subj') || A.$('#st-subj'))?.value || c.subject, body = (A.$('#m-body') || A.$('#st-body'))?.value ?? c.message;
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

/* sequence tab: step 1 is the campaign message; follow-ups are steps 2 and 3 */
const stepText = (c, n) => { if (!n || n <= 1) return { channel: 'form', subject: c.subject, message: c.message }; const st = (c.steps || []).find(x => x.step === n); return st ? { channel: st.channel, subject: st.subject || c.subject, message: st.message, delay_days: st.delay_days } : { channel: 'form', subject: c.subject, message: c.message }; };
function seqBar(c) {
  const P = cp(c.id), steps = c.steps || [];
  const chip = (n, ch, sub) => `<button class="seqstep ${P.step === n ? 'on' : ''}" data-seqstep="${n}"><i>${n}</i><span><b>${ch === 'call' ? 'Call' : 'Contact form'}</b><small>${sub}</small></span></button>`;
  let day = 0;
  return `<div class="card seqbar">${chip(1, 'form', 'Day 0 · first message')}${steps.map(x => { day += x.delay_days; return `<span class="seqwait">${A.ic('arrow', 13)}<small>wait ${x.delay_days} business day${x.delay_days === 1 ? '' : 's'}</small></span>${chip(x.step, x.channel, `Day ${day} · follow-up`)}`; }).join('')}
    ${steps.length < 2 ? `<button class="seqadd" data-o="addstep">${A.ic('plus', 14)}Add follow-up</button>` : ''}
    <span class="seqnote">${steps.length ? 'Stops for a lead when you mark them Replied or Do not contact.' : 'Add a follow-up or a call. Sequences stop when a lead replies.'}</span></div>`;
}
function sequenceTab(c) {
  const P = cp(c.id); P.step ||= 1;
  if (P.step > 1 && !(c.steps || []).some(x => x.step === P.step)) P.step = 1;
  return `${seqBar(c)}${P.step === 1 ? messageTab(c) : stepEditor(c, (c.steps || []).find(x => x.step === P.step))}`;
}
function stepEditor(c, st) {
  const isCall = st.channel === 'call';
  return `<div class="msgrid">
    <div class="card"><div class="card-h"><div><h3>Step ${st.step}: ${isCall ? 'Call' : 'Follow-up message'}</h3><p>${isCall ? 'Shows up in your Manual queue with their phone number and this script.' : c.mode === 'manual' ? 'Goes to your Manual queue to send with Fill form.' : 'The robot sends it through the same contact form.'}</p></div><span class="help" id="st-save"></span></div>
      <div class="card-b" style="display:flex;flex-direction:column;gap:14px">
        <div class="row" style="gap:14px;align-items:flex-end">
          <div class="field"><span class="flabel">Type</span><div class="seg-c"><button class="${!isCall ? 'on' : ''}" data-stch="form">${A.ic('messages', 13)}Contact form</button><button class="${isCall ? 'on' : ''}" data-stch="call">${A.ic('phone', 13)}Call</button></div></div>
          <div class="field"><label for="st-delay">Send after</label><div class="sset-suffix"><input class="input" id="st-delay" type="number" min="1" max="30" value="${st.delay_days}"><span>business days</span></div></div>
          <button class="btn ghost sm" data-o="rmstep" style="margin-left:auto;color:var(--bad)">${A.ic('trash', 13)}Remove step</button>
        </div>
        ${isCall ? '' : `<div class="field"><label for="st-subj">Subject <span class="opt-tag">empty = same as step 1</span></label><input class="input big" id="st-subj" value="${A.esc(st.subject)}" maxlength="200" placeholder="${A.esc(c.subject)}"></div>`}
        <div class="field"><div class="row" style="justify-content:space-between"><label for="st-body">${isCall ? 'Call script' : 'Message'}</label><button class="linkbtn muted" data-o="frombook">${A.ic('playbook', 13)} Use from Playbook</button></div>
          <textarea class="input mbody" id="st-body" maxlength="5000" placeholder="${isCall ? 'Hi, this is Alfred from The Bat Marketing. I sent a note through your website about…' : 'Hi [Company Name] team,&#10;&#10;Just following up on my note from last week…&#10;&#10;Best,&#10;Alfred'}">${A.esc(st.message)}</textarea></div>
        <div class="tagbar"><span class="help">Insert</span>${MERGE_TAGS.map(t => `<button class="chip" data-tag="[${t}]">[${t}]</button>`).join('')}</div>
      </div></div>
    ${isCall ? `<div class="card pvcard"><div class="card-h"><h3>How it looks in your queue</h3></div><div class="card-b"><div class="callprev"><span class="pill" style="--c:var(--info)">Call</span><b>${A.esc(cleanCompanyName(previewLeads(c)[0].name))}</b><a class="callnum">${A.ic('phone', 15)}(512) 555-0142</a><p>${A.esc(personalize(st.message || 'Your script appears here.', previewLeads(c)[0]))}</p><div class="row" style="gap:6px"><span class="btn sm">Talked</span><span class="btn sm">Voicemail</span><span class="btn sm">No answer</span></div></div></div></div>`
      : `<div class="card pvcard"><div class="card-h"><div class="seg-c"><button class="${cp(c.id).previewMode === 'text' ? 'on' : ''}" data-pvmode="text">Form text</button><button class="${cp(c.id).previewMode === 'file' ? 'on' : ''}" data-pvmode="file">File</button></div>
      <div class="row pvnav"><button class="iconbtn sm" data-pvnav="-1" aria-label="Previous lead">${A.ic('back', 14)}</button><span id="pv-who" class="help"></span><button class="iconbtn sm" data-pvnav="1" aria-label="Next lead">${A.ic('arrow', 14)}</button></div></div><div id="pv" class="card-b"></div></div>`}
  </div>`;
}
let stT = 0, stPendingC = null;
function flushSteps() { if (stT) { clearTimeout(stT); stT = 0; if (stPendingC) saveSteps(stPendingC); } }
function queueSteps(c, immediate) {
  stPendingC = c;
  const P = cp(c.id), st = (c.steps || []).find(x => x.step === P.step);
  if (st && A.$('#st-body')) { st.message = A.$('#st-body').value; if (A.$('#st-subj')) st.subject = A.$('#st-subj').value; st.delay_days = Math.max(1, Math.min(30, +A.$('#st-delay').value || 3)); }
  const sv = A.$('#st-save'); if (sv) sv.textContent = 'Saving…';
  clearTimeout(stT); stT = setTimeout(() => { stT = 0; saveSteps(c); }, immediate ? 0 : 700);
}
async function saveSteps(c) {
  try { const r = await A.api('PUT', `/api/campaigns/${c.id}/steps`, { steps: (c.steps || []).map(x => ({ channel: x.channel, delay_days: x.delay_days, subject: x.subject, message: x.message })) }); upsertCampaign(r.campaign); const sv = A.$('#st-save'); if (sv) sv.innerHTML = `<span class="okline">${A.ic('check', 12)}Saved</span>`; const bar = document.querySelector('.seqbar'); if (bar) bar.outerHTML = seqBar(r.campaign); }
  catch (e) { const sv = A.$('#st-save'); if (sv) sv.innerHTML = `<span style="color:var(--bad)">${A.esc(e.message)}</span>`; else A.toast(e.message, 'alert'); }
}
async function playbookPicker(c) {
  if (!NT.loaded) await loadNotes();
  A.$('#overlay').innerHTML = `<div class="scrim modal-scrim" data-act="close"><div class="modal" data-stop role="dialog" aria-label="Use from Playbook">
    <div class="card-h"><div><h2>Use from Playbook</h2><p>Copies the note's subject and message into this step.</p></div><button class="btn ghost sm" data-act="close" aria-label="Close">${A.ic('x')}</button></div>
    <div class="card-b" style="display:flex;flex-direction:column;gap:8px;max-height:60vh;overflow-y:auto">${NT.notes.length ? NT.notes.map(n => `<button class="opt sm pbpick" data-pbnote="${n.id}"><div style="text-align:left"><b>${A.esc(n.title || 'Untitled')}</b><span>${A.esc((n.subject || n.body || '').replace(/\s+/g, ' ').slice(0, 90))}</span></div></button>`).join('') : '<p class="help" style="margin:0">Your Playbook is empty. Write notes there first.</p>'}</div></div></div>`;
}

/* settings tab */
function settingsTab(c) {
  const hours = (sel, from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i).map(h => `<option value="${h}" ${h === sel ? 'selected' : ''}>${hourLbl(h)}</option>`).join('');
  const sec = (title, desc, body, cls = '') => `<section class="sset-row ${cls}"><div class="sset-l"><h4>${title}</h4><p>${desc}</p></div><div class="sset-r">${body}</div></section>`;
  return `<div class="card sset">
    <div class="sset-top"><span class="help">Changes save automatically</span><span class="help" id="s-save"></span></div>
    ${sec('Basics', 'The campaign name is just for you. The sender profile is what forms receive.', `
      <div class="field"><label for="s-name">Campaign name</label><input class="input" id="s-name" data-ssave="name" value="${A.esc(c.name)}" maxlength="80"></div>
      <div class="field"><label for="s-sender">Send as</label><div class="sset-inline"><select class="input" id="s-sender" data-ssave="sender_id"><option value="">Choose a sender profile</option>${OS.senders.map(s => `<option value="${s.id}" ${s.id === c.sender_id ? 'selected' : ''}>${A.esc(s.label)} · ${A.esc(s.email)}</option>`).join('')}</select><button class="btn" data-o="newsender">${A.ic('plus', 13)}New</button></div></div>`)}
    ${sec('How it sends', 'Switching moves leads that are waiting: to your Manual queue, or back to the robot.', modeOpts(c.mode || 'auto', 'smode'))}
    ${c.mode === 'manual' ? '' : sec('Schedule', 'When the robot sends, in Los Angeles time. Business hours look the most natural.', `
      <div class="sset-sched">
        <div class="field"><label for="s-limit">Daily limit</label><div class="sset-suffix"><input class="input" id="s-limit" type="number" min="1" max="2000" data-ssave="daily_limit" value="${c.daily_limit}"><span>forms a day</span></div></div>
        <div class="field"><label>Sending hours</label><div class="sset-inline"><select class="input" data-ssave="window_start" aria-label="From">${hours(c.window_start, 0, 23)}</select><span class="help">to</span><select class="input" data-ssave="window_end" aria-label="Until">${hours(c.window_end, 1, 24)}</select></div></div>
      </div>
      <div class="field"><label>Sending days</label><div class="days" role="group">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button class="${c.weekdays.includes(String(d)) ? 'on' : ''}" data-day="${d}" aria-pressed="${c.weekdays.includes(String(d))}">${DAYS[d]}</button>`).join('')}</div></div>`)}
    ${sec('Attachment', 'Only used when a form requires a file upload.', `
      <div class="sfile"><div class="sfile-ic">${A.ic('copy', 18)}</div><div><b>The Bat Marketing</b><span>PDF · page 1 is your subject and message, page 2 your offer. Image-only forms get page 1 as an image.</span></div><button class="btn sm" data-o="previewfile">Preview</button></div>`)}
    ${sec('Delete campaign', 'Removes the campaign and its results. Contacted leads stay marked Contacted.', `<div><button class="btn danger-out" data-o="delcamp">${A.ic('trash', 14)}Delete campaign</button></div>`, 'sset-danger')}
  </div>`;
}
async function saveSetting(c, patch) {
  const sv = A.$('#s-save'); if (sv) sv.textContent = 'Saving…';
  try { const r = await A.api('PUT', `/api/campaigns/${c.id}`, patch); upsertCampaign(r.campaign); refreshCampaignChrome(r.campaign); const s2 = A.$('#s-save'); if (s2) s2.innerHTML = `<span class="okline">${A.ic('check', 12)}Saved</span>`; }
  catch (e) { const s2 = A.$('#s-save'); if (s2) s2.innerHTML = `<span style="color:var(--bad)">${A.esc(e.message)}</span>`; }
}
function refreshCampaignChrome(c) {
  const set = (sel, html) => { const el = A.$(sel); if (el) el.innerHTML = html; };
  set('#c-actions', actionsHTML(c)); set('#c-banner', bannerHTML(c)); set('#c-stats', statsHTML(c)); set('#c-ready', readyHTML(c));
  const meta = document.querySelector('.chead .meta'); if (meta) meta.innerHTML = cmeta(c);
  const h = document.querySelector('.chead h1'); if (h) h.textContent = c.name;
  document.querySelectorAll('.ctabs [data-ctab="leads"] .n').forEach(n => { n.textContent = A.fmt(c.counts.total); });
  const fl = document.querySelector('.ofilters .tabs');
  if (fl) { const n = c.counts, cnt = { all: n.total, queued: n.queued + n.sending, sent: contacted(c), noconf: n.submitted, manual: n.manual, failed: n.failed, skipped: n.skipped }; fl.querySelectorAll('[data-ofilter]').forEach(b => { b.querySelector('.n').textContent = A.fmt(cnt[b.dataset.ofilter]); }); }
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
  // Show what's already loaded straight away and refresh quietly: coming back to a campaign shouldn't flash or reset.
  const P = cp(id); P.prevJob = c.job ? { id: c.job.id, status: c.job.status, done: c.job.done } : null;
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
      ${live.length ? `<div class="acpick">${live.map(c => `<label class="opt sm ${AC.cid === c.id ? 'on' : ''}"><input type="radio" name="accamp" value="${c.id}" ${AC.cid === c.id ? 'checked' : ''}><div><b>${A.esc(c.name)}</b><span>${CSTATUS[c.status][0]}${c.mode === 'manual' ? ' · Manual' : ''} · ${A.fmt(c.counts.total)} leads · ${A.fmt(contacted(c))} sent</span></div></label>`).join('')}</div>` : `<p style="margin:0;color:var(--muted)">You don't have a campaign yet.</p>`}
      <button class="linkbtn" data-o="acnew" style="align-self:flex-start">${A.ic('plus', 12)} New campaign</button>
      ${AC.cid ? `<div class="acsum">${!s ? `<span class="spin"></span> Checking these leads…` : `
        ${s.mode === 'manual' ? `<div class="acline man"><b class="num">${A.fmt(s.manual)}</b> go to your Manual queue to send yourself (manual campaign)</div>` : `<div class="acline ok"><b class="num">${A.fmt(s.add)}</b> will be queued for sending</div>
        ${s.manual ? `<div class="acline man"><b class="num">${A.fmt(s.manual)}</b> go to the Manual queue (their form has a CAPTCHA)</div>` : ''}`}
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
  const payload = { v: 1, api: location.origin, oid: it.id, token: it.fill_token, ...(snd ? localizeProfile(engineProfile(snd), snd, { city: it.city, state: it.region, zip: it.postal, country: it.country }) : {}), subject, message, leadCompany: cleanCompanyName(it.name) };
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
const MQ_REASONS = [['all', 'All'], ['call', 'Calls'], ['followup', 'Follow-ups'], ['manual', 'Manual campaigns'], ['captcha', 'CAPTCHA'], ['interrupted', 'Interrupted'], ['login-required', 'Login'], ['other', 'Other']];
const mqGroup = r => ['call', 'followup', 'manual', 'captcha', 'interrupted', 'login-required'].includes(r) ? r : 'other';
const ageLbl = t => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${Math.max(1, m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
const REASON_C = { call: 'var(--info)', followup: 'var(--ok)', manual: 'var(--accent)', captcha: 'var(--manual)', interrupted: 'var(--warn)', 'login-required': 'var(--info)', other: 'var(--idle)' };
const REASON_SHORT = { call: 'Call', followup: 'Follow-up', manual: 'Manual', captcha: 'CAPTCHA', interrupted: 'Interrupted', 'login-required': 'Login', 'file-type': 'Word file', 'directory-page': 'Directory page' };
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
  return `<div class="head"><div><div class="eyebrow">Outreach</div><h1>Manual queue</h1><p>${MQ.items.length ? `<b class="num">${A.fmt(MQ.items.length)}</b> ${MQ.items.length === 1 ? 'task needs' : 'tasks need'} you.` : ''} Calls and manual follow-ups from your sequences, forms with a CAPTCHA, and anything the robot couldn't finish.${MQ.done ? ` <span class="okline">${A.ic('check', 12)}${MQ.done} done this session</span>` : ''}</p></div>
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
  const stx = c ? stepText(c, it.step) : null;
  const subj = stx ? personalize(stx.subject, lead) : '', msg = stx ? personalize(stx.message, lead) : '';
  const url = it.form_url || it.website;
  const list = mqFiltered(), pos = list.indexOf(it);
  if (it.reason === 'call') return mqCall(it, c, lead, msg, pos, list);
  const canFill = hasExt() && it.fill_token && snd && subj && msg && url && it.reason !== 'login-required';
  const f = (k, v) => v ? `<div class="mfield"><span class="k">${k}</span><span class="val">${A.esc(v)}</span><button class="dcopy" data-copy="${A.esc(v)}">${A.ic('copy', 12)}<span>Copy</span></button></div>` : '';
  const why = it.reason === 'followup' ? `Follow-up (step ${it.step}) for a manual campaign. Fill form opens it with the follow-up message.` : it.reason === 'manual' ? 'This campaign is manual, so you send each form yourself. Fill form opens it already filled in.' : it.reason === 'captcha' ? 'This form has a CAPTCHA you need to solve. Everything else is filled in for you.' : it.reason === 'interrupted' ? 'The robot stopped while sending this one. Open the form and check whether it went through before sending again.' : reasonText(it.reason);
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
function mqCall(it, c, lead, script, pos, list) {
  const tel = String(it.phone || '').replace(/[^\d+]/g, '');
  return `<div class="mqw-h"><div><h2>${A.esc(cleanCompanyName(it.name))}</h2><p>Call · step ${it.step} · ${A.esc(it.campaign)}</p></div><div class="mqw-nav"><button class="iconbtn sm" data-mqnav="-1" aria-label="Previous" ${pos <= 0 ? 'disabled' : ''}>${A.ic('back', 14)}</button><span class="num">${pos + 1} / ${list.length}</span><button class="iconbtn sm" data-mqnav="1" aria-label="Next" ${pos >= list.length - 1 ? 'disabled' : ''}>${A.ic('arrow', 14)}</button></div></div>
    <div class="mqw-b">
      ${it.phone ? `<a class="btn primary mqopen" href="tel:${A.esc(tel)}">${A.ic('phone', 15)}Call ${A.esc(it.phone)}</a>` : `<div class="note">${A.ic('alert')}<div>No phone number for this business. Skip it or mark the outcome.</div></div>`}
      ${it.website ? `<a class="linkbtn muted" href="${A.esc(it.website)}" target="_blank" rel="noopener">${A.esc(domain(it.website))}</a>` : ''}
      <div class="callscript"><h6>Script</h6><p>${A.esc(script || 'No script written for this step.')}</p></div>
    </div>
    <div class="mqw-f"><span class="help" style="width:100%">How did it go?</span><button class="btn primary" data-mqcall="talked">Talked</button><button class="btn" data-mqcall="voicemail">Left voicemail</button><button class="btn" data-mqcall="noanswer">No answer</button><button class="btn" data-mqact="replied" title="Stops their sequence">${A.ic('messages', 14)}They replied</button><button class="btn ghost" data-mqact="skip" style="margin-left:auto">Skip</button></div>`;
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
async function mqAction(act, outcome) {
  const it = MQ.items[MQ.sel]; if (!it) return;
  const list = mqFiltered(), pos = list.indexOf(it);
  try {
    await A.api('POST', `/api/outreach/${it.id}`, { action: act, outcome });
    MQ.items.splice(MQ.sel, 1); MQ.checked?.delete(it.id); MQ.done = (MQ.done || 0) + 1;
    const rest = list.filter(x => x !== it), next = rest[Math.min(pos, rest.length - 1)];
    MQ.sel = next ? MQ.items.indexOf(next) : 0;
    OS.manual = Math.max(0, OS.manual - 1); A.renderNav('manual');
    A.toast({ sent: 'Marked as sent', retry: 'Sent back to the robot', skip: 'Skipped', dnc: 'Marked do not contact', call: 'Call logged', replied: 'Marked replied. Their sequence is stopped.' }[act]);
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

/* ------------------------------------------------------------------ messages: notes for drafting outreach */
const NT = { notes: [], loaded: false, sel: null, q: '', tag: 'all' };
const NOTE_TAGS = [['idea', 'Idea', 'var(--info)'], ['draft', 'Draft', 'var(--warn)'], ['ready', 'Ready', 'var(--ok)'], ['flow', 'Flow', 'var(--manual)']];
const byOrder = (a, z) => (z.pinned - a.pinned) || (a.position - z.position) || (z.id - a.id);
const tagOf = k => NOTE_TAGS.find(t => t[0] === k) || NOTE_TAGS[0];
async function loadNotes() { try { NT.notes = (await A.api('GET', '/api/notes')).notes; NT.loaded = true; if (NT.sel == null && NT.notes[0]) NT.sel = NT.notes[0].id; if (A.currentView() === 'playbook') A.render(); } catch (e) { A.toast(e.message, 'alert'); } }
const ntFiltered = () => { const q = NT.q.trim().toLowerCase(); return NT.notes.filter(n => (NT.tag === 'all' || n.tag === NT.tag) && (!q || `${n.title} ${n.subject} ${n.body}`.toLowerCase().includes(q))); };
// A slight, stable tilt per note so the board looks like real paper.
const tilt = id => (((id * 37) % 7) - 3) * 0.55;
function messagesView() {
  if (!NT.loaded) { loadNotes(); return loading(); }
  const list = ntFiltered();
  return `<div class="head"><div><div class="eyebrow">Outreach</div><h1>Playbook</h1><p>Your outreach playbook: angles, message drafts and follow-up flows. When one's ready, send it to a campaign in one click.</p></div>
    <div class="row"><button class="btn primary" data-o="newnote">${A.ic('plus')}New note</button></div></div>
  ${NT.notes.length ? `<div class="desk-bar"><div class="lsearch">${A.ic('find', 15)}<input id="nt-q" placeholder="Search notes" value="${A.esc(NT.q)}" autocomplete="off"></div>
      <div class="tabs" id="nt-tabs">${ntTabs()}</div></div>
    <div class="desk" id="nt-list">${ntList()}</div>`
  : `<div class="desk desk-empty">
      <button class="paper paper-new" data-o="newnote" style="--tilt:-1.5deg"><span class="tape" style="--tape:var(--accent)"></span><b class="hand">A blank page</b><span>Start from scratch</span></button>
      ${[['Missed calls angle', 'idea', 'When a homeowner calls and nobody picks up, they call the next contractor…'], ['Website refresh pitch', 'draft', 'I spotted a few quick wins on your website that could bring you more calls…'], ['3-touch follow-up flow', 'flow', 'Day 1: contact form, website angle\nDay 4: follow-up\nDay 9: last touch']].map(([t, g, b], i) => `<button class="paper" data-o="newnote" data-title="${t}" data-ntype="${g}" data-body="${A.esc(b)}" style="--tilt:${[1.2, -0.8, 1.6][i]}deg"><span class="tape" style="--tape:${tagOf(g)[2]}"></span><b class="hand">${t}</b><p>${A.esc(b)}</p><span class="stamp" style="--c:${tagOf(g)[2]}">${tagOf(g)[1]}</span></button>`).join('')}
    </div><p class="help" style="text-align:center;margin-top:-6px">Pick a starter or a blank page. Merge tags like [Company Name] work here too.</p>`}`;
}
const ntTabs = () => [['all', 'All'], ...NOTE_TAGS].map(([k, l]) => `<button class="${NT.tag === k ? 'on' : ''}" data-nttag="${k}">${l}<span class="n">${k === 'all' ? NT.notes.length : NT.notes.filter(n => n.tag === k).length}</span></button>`).join('');
function ntList() {
  setTimeout(() => { const t = A.$('#nt-tabs'); if (t) t.innerHTML = ntTabs(); }, 0);   // stage counts follow every change
  const list = ntFiltered();
  if (!list.length) return `<div class="empty" style="grid-column:1/-1"><b>No notes match</b>Try another word or stage.</div>`;
  return `<button class="paper paper-new" data-o="newnote" style="--tilt:0deg"><span class="plus">${A.ic('plus', 22)}</span><b class="hand">New note</b></button>` + list.map(n => { const [, l, c] = tagOf(n.tag);
    return `<button class="paper ${n.pinned ? 'pinned' : ''}" data-note="${n.id}" title="Click to open · drag to reorder" style="--tilt:${tilt(n.id)}deg">${n.pinned ? '<span class="pin"></span>' : `<span class="tape" style="--tape:${c}"></span>`}
      <b class="hand">${A.esc(n.title || 'Untitled')}</b>
      ${n.subject ? `<i class="psubj">${A.esc(n.subject)}</i>` : ''}
      <p>${A.esc((n.body || '').slice(0, 260)) || '<span class="faint">Empty page</span>'}</p>
      ${n.memo ? `<span class="pmemo">${A.esc(n.memo.slice(0, 70))}</span>` : ''}
      <span class="pfoot"><span class="stamp" style="--c:${c}">${l}</span><small>${A.esc(A.whenPT(n.updated_at).replace(' PT', '').replace(/^Today, /, ''))}</small></span></button>`; }).join('');
}
function ntEditor() {
  const n = NT.notes.find(x => x.id === NT.sel); if (!n) return '';
  const warn = unknownTags(n.subject + ' ' + n.body);
  return `<div class="scrim modal-scrim sheet-scrim" data-act="close"><div class="sheet-wrap" data-stop role="dialog" aria-label="${A.esc(n.title || 'Note')}">
    <div class="sheet" style="--tilt:${tilt(n.id) / 3}deg">
      <span class="tape tape-l" style="--tape:${tagOf(n.tag)[2]}"></span><span class="tape tape-r" style="--tape:${tagOf(n.tag)[2]}"></span>
      <div class="sheet-top"><input class="hand sheet-title" id="nt-title" value="${A.esc(n.title)}" placeholder="Untitled note" maxlength="120" aria-label="Title">
        <div class="row" style="gap:6px;flex-wrap:nowrap"><span class="help" id="nt-save"></span><button class="iconbtn sm" data-act="close" aria-label="Close">${A.ic('x', 14)}</button></div></div>
      <label class="sheet-lbl" for="nt-subj">Subject</label>
      <input class="sheet-subj" id="nt-subj" value="${A.esc(n.subject)}" placeholder="Quick question about [Company Name]" maxlength="200">
      <label class="sheet-lbl" for="nt-body">Message</label>
      <textarea class="sheet-body" id="nt-body" placeholder="Hi [Company Name] team,&#10;&#10;…">${A.esc(n.body)}</textarea>
      <div class="sheet-tags">${MERGE_TAGS.map(t => `<button class="chip" data-ntag="[${t}]">[${t}]</button>`).join('')}<span class="help num" id="nt-count">${n.body.length} characters</span></div>
      ${warn.length ? `<div class="note" style="margin-top:8px">${A.ic('alert')}<div>${warn.map(w => `<b>${A.esc(w)}</b>`).join(', ')} ${warn.length === 1 ? "isn't a merge tag" : "aren't merge tags"} and would be sent exactly as written.</div></div>` : ''}
    </div>
    <div class="sticky" style="--tilt:${tilt(n.id + 3) + 2}deg"><span class="sticky-h hand">Notes</span><textarea id="nt-memo" class="hand" placeholder="The angle, who it's for, what worked…">${A.esc(n.memo || '')}</textarea></div>
    <div class="sheet-bar">
      <div class="stamps">${NOTE_TAGS.map(([k, l, c]) => `<button class="stamp ${n.tag === k ? 'on' : ''}" style="--c:${c}" data-notetag="${k}">${l}</button>`).join('')}</div>
      <div class="row" style="gap:6px"><button class="iconbtn" data-o="pinnote" title="${n.pinned ? 'Unpin' : 'Pin to the top'}" aria-label="Pin">${n.pinned ? '📌' : '📍'}</button><button class="iconbtn" data-o="delnote" title="Delete" aria-label="Delete note">${A.ic('trash', 15)}</button><button class="btn" data-o="notecopy">${A.ic('copy', 14)}Copy</button><button class="btn primary" data-o="notetocamp" ${n.body.trim() ? '' : 'disabled'}>${A.ic('campaigns', 14)}Use in a campaign</button></div>
    </div></div></div>`;
}
function openNote(id) { NT.sel = id; A.$('#overlay').innerHTML = ntEditor(); setTimeout(() => A.$('#nt-body')?.focus(), 0); }
let ntT = 0, ntPending = null, ntLast = 'nt-body';
function ntQueueSave() {
  const n = NT.notes.find(x => x.id === NT.sel); if (!n) return;
  n.title = A.$('#nt-title').value; n.subject = A.$('#nt-subj').value; n.body = A.$('#nt-body').value; n.memo = A.$('#nt-memo').value;
  ntPending = { id: n.id, title: n.title, subject: n.subject, body: n.body, memo: n.memo };
  A.$('#nt-save').textContent = 'Saving…'; A.$('#nt-count').textContent = `${n.body.length} characters`;
  clearTimeout(ntT); ntT = setTimeout(ntFlush, 600);
}
async function ntFlush(extra) {
  clearTimeout(ntT);
  const ps = ntPending || (extra ? { id: NT.sel } : null); ntPending = null; if (!ps) return;
  try { const r = await A.api('PUT', `/api/notes/${ps.id}`, { ...ps, ...(extra || {}) }); const i = NT.notes.findIndex(x => x.id === r.note.id); if (i >= 0) NT.notes[i] = r.note; NT.notes.sort(byOrder); const sv = A.$('#nt-save'); if (sv) sv.innerHTML = `<span class="okline">${A.ic('check', 12)}Saved</span>`; const l = A.$('#nt-list'); if (l) l.innerHTML = ntList(); }
  catch (e) { A.toast(e.message, 'alert'); }
}
function noteToCampaignModal(n) {
  const live = OS.campaigns.filter(c => c.status !== 'archived');
  A.$('#overlay').innerHTML = `<div class="scrim modal-scrim" data-act="close"><div class="modal" data-stop role="dialog" aria-label="Use in a campaign">
    <div class="card-h"><div><h2>Use “${A.esc(n.title || 'this note')}” in a campaign</h2><p>Replaces the campaign's subject and message. Sends already made keep the version they used.</p></div><button class="btn ghost sm" data-act="close" aria-label="Close">${A.ic('x')}</button></div>
    <div class="card-b" style="display:flex;flex-direction:column;gap:8px">
      ${live.map((c, i) => `<label class="opt sm ${i === 0 ? 'on' : ''}"><input type="radio" name="ntcamp" value="${c.id}" ${i === 0 ? 'checked' : ''}><div><b>${A.esc(c.name)}</b><span>${CSTATUS[c.status][0]} · subject now: ${A.esc((c.subject || '—').slice(0, 60))}</span></div></label>`).join('')}
      <label class="opt sm ${live.length ? '' : 'on'}"><input type="radio" name="ntcamp" value="new" ${live.length ? '' : 'checked'}><div><b>New campaign</b><span>Creates a draft campaign with this message</span></div></label>
      ${n.subject ? '' : `<div class="note neutral">${A.ic('alert')}<div>This note has no subject line, so the campaign keeps its current subject.</div></div>`}
      <div class="help" id="ntc-err" style="color:var(--bad)"></div></div>
    <div class="card-h" style="border-top:1px solid var(--line);border-bottom:0;justify-content:flex-end"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-o="notetocampok">Use this message</button></div></div></div>`;
}

/* drag to reorder notes (mouse and touch) */
const ntDrag = { justDropped: false };
function ntPointerDown(e) {
  const card = e.target.closest('.desk .paper[data-note]');
  if (!card || e.button > 0 || NT.q || NT.tag !== 'all') return;   // reorder the full board only
  Object.assign(ntDrag, { card, x: e.clientX, y: e.clientY, started: false, touch: e.pointerType === 'touch', armed: e.pointerType !== 'touch' });
  if (ntDrag.touch) ntDrag.timer = setTimeout(() => { ntDrag.armed = true; card.classList.add('paper-lift'); }, 280);   // long-press on phones, so the page still scrolls
}
function ntStart(e) {
  const r = ntDrag.card.getBoundingClientRect();
  const g = ntDrag.card.cloneNode(true); g.classList.add('paper-ghost'); g.style.width = r.width + 'px'; g.style.height = r.height + 'px';
  document.body.appendChild(g);
  Object.assign(ntDrag, { started: true, ghost: g, offX: e.clientX - r.left, offY: e.clientY - r.top });
  ntDrag.card.classList.add('paper-placeholder'); ntDrag.card.classList.remove('paper-lift'); document.body.classList.add('dragging-notes');
}
function ntPointerMove(e) {
  if (!ntDrag.card) return;
  if (!ntDrag.started) {
    const d = Math.hypot(e.clientX - ntDrag.x, e.clientY - ntDrag.y);
    if (!ntDrag.armed) { if (d > 8) { clearTimeout(ntDrag.timer); ntDrag.card = null; } return; }
    if (d < 6) return;
    ntStart(e);
  }
  ntDrag.ghost.style.transform = `translate(${e.clientX - ntDrag.offX}px, ${e.clientY - ntDrag.offY}px) rotate(2.5deg) scale(1.04)`;
  const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.desk .paper[data-note]');
  if (over && over !== ntDrag.card) { const r = over.getBoundingClientRect(); over.parentNode.insertBefore(ntDrag.card, e.clientX > r.left + r.width / 2 ? over.nextSibling : over); }
  const edge = 70; if (e.clientY < edge) scrollBy(0, -12); else if (e.clientY > innerHeight - edge) scrollBy(0, 12);
}
async function ntPointerUp() {
  clearTimeout(ntDrag.timer);
  const d = ntDrag; if (!d.card) return;
  d.card.classList.remove('paper-lift');
  if (!d.started) { d.card = null; return; }
  d.ghost.remove(); d.card.classList.remove('paper-placeholder'); document.body.classList.remove('dragging-notes');
  ntDrag.justDropped = true; setTimeout(() => { ntDrag.justDropped = false; }, 60);
  const ids = [...document.querySelectorAll('.desk .paper[data-note]')].map(x => +x.dataset.note);
  ids.forEach((id, i) => { const n = NT.notes.find(x => x.id === id); if (n) n.position = i; });
  NT.notes.sort(byOrder); d.card = null;
  A.$('#nt-list').innerHTML = ntList();   // pinned notes stay first
  try { await A.api('PUT', '/api/notes/order', { ids: NT.notes.map(n => n.id) }); } catch (e) { A.toast(e.message, 'alert'); }
}

/* ------------------------------------------------------------------ sender profiles */
function sendersView() {
  if (!OS.loaded) { loadOutreach().then(() => A.currentView() === 'senders' && A.render()); return loading(); }
  const camps = id => OS.campaigns.filter(c => c.sender_id === id && c.status !== 'archived');
  const row = (icon, val, auto, label) => `<div class="spc-row"><span class="spc-ic" title="${label}">${A.ic(icon, 15)}</span><span class="spc-v ${auto ? 'auto' : ''}">${A.esc(val)}</span>${auto ? '<span class="spc-auto" title="Empty in your profile, so forms get this default">auto</span>' : ''}</div>`;
  const card = s => {
    const cs = camps(s.id), name = [s.first_name, s.last_name].filter(Boolean).join(' ');
    const hasAddr = [s.address, s.city, s.state, s.zip].some(Boolean);
    const addr = hasAddr ? [s.address, s.city, [s.state, s.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') : 'Matches each business’s city';
    const opt = [s.company, s.website, hasAddr].filter(Boolean).length, done = 3 + opt;
    const sub = [name, s.company && s.company !== s.label ? s.company : ''].filter(Boolean).join(' · ');
    return `<article class="card spc">
      <div class="spc-top">
        <div class="spc-av">${A.esc(initials(s))}</div>
        <div class="spc-id"><h3>${A.esc(s.label || name || 'Sender')}</h3>${sub ? `<span>${A.esc(sub)}</span>` : ''}
        <span class="spc-use ${cs.length ? 'on' : ''}" title="${A.esc(cs.map(c => c.name).join(', '))}">${cs.length ? `In ${cs.length} campaign${cs.length === 1 ? '' : 's'}` : 'Not used yet'}</span></div>
      </div>
      <div class="spc-rows">
        ${row('mail', s.email, false, 'Email')}${row('phone', s.phone, false, 'Phone')}
        ${row('building', s.company || fbHint('company', s).replace(/ \(.*\)$/, ''), !s.company, 'Company')}
        ${row('globe', s.website || fbHint('website', s).replace(/ \(.*\)$/, ''), !s.website, 'Website')}
        ${row('pin', addr, !hasAddr, 'Address')}
      </div>
      <div class="spc-foot">
        <div class="spc-meter" title="Name, email and phone are required. Empty optional fields use safe defaults."><div><i style="width:${Math.round(done / 6 * 100)}%"></i></div><span>${done === 6 ? 'Complete' : `${done} of 6 filled`}</span></div>
        <button class="btn sm" data-o="editsender" data-sid="${s.id}">${A.ic('edit', 13)}Edit</button>
      </div>
    </article>`;
  };
  return `<div class="head"><div><div class="eyebrow">Outreach</div><h1>Sender profiles</h1><p>Who your messages come from. The robot types these details into every contact form it fills.</p></div>
    <div class="row"><button class="btn primary" data-o="newsender">${A.ic('plus')}New profile</button></div></div>
  <div class="spc-how">
    <div><span class="spc-hi">${A.ic('check', 14)}</span><b>Always sent</b><small>Name, email and phone</small></div>
    <div><span class="spc-hi">${A.ic('building', 14)}</span><b>When a form asks</b><small>Company, website and address</small></div>
    <div><span class="spc-hi">${A.ic('shield', 14)}</span><b>Never blank</b><small>Empty fields get a safe default, marked <em>auto</em></small></div>
  </div>
  <div class="spcs">${OS.senders.map(card).join('')}
    <button class="spc spc-add" data-o="newsender"><span class="spc-plus">${A.ic('plus', 20)}</span><b>New profile</b><span>Another name or brand to send as</span></button></div>`;
}
const fbHint = (k, s) => SENDER_FALLBACKS[k] ? SENDER_FALLBACKS[k].hint(s) : '';
function senderDrawer(s = {}, onSaved) {
  const f = (k, label, ph = '', type = 'text', help = '') => {
    const fb = SENDER_FALLBACKS[k];
    return `<div class="field"><label for="sp-${k}">${label}${fb ? ' <span class="opt-tag">optional</span>' : ''}</label><input class="input" id="sp-${k}" type="${type}" value="${A.esc(s[k] || '')}" placeholder="${fb ? A.esc(fbHint(k, s).replace(/ \(.*\)$/, '')) : ph}" autocomplete="off" data-spf="${k}">
      ${fb ? `<span class="help fbh" data-fb="${k}" ${String(s[k] || '').trim() ? 'hidden' : ''}>If left empty, forms get: <b>${A.esc(fbHint(k, s))}</b></span>` : help ? `<span class="help">${help}</span>` : ''}</div>`;
  };
  A.$('#overlay').innerHTML = `<div class="scrim" data-act="close"><div class="drawer" data-stop role="dialog" aria-label="Sender profile">
    <div class="drawer-h"><div class="spc-dh"><div class="spc-av sm">${s.first_name ? A.esc(initials(s)) : A.ic('senders', 18)}</div><div><div class="eyebrow" style="margin:0 0 4px">${s.id ? 'Edit sender profile' : 'New sender profile'}</div><h2>${A.esc(s.label || 'Sender profile')}</h2></div></div><button class="btn ghost sm" data-act="close" aria-label="Close">${A.ic('x')}</button></div>
    <section><h5>Always used</h5><div class="fsrow2">${f('first_name', 'First name', 'Dustin')}${f('last_name', 'Last name', 'Morgan')}</div>${f('email', 'Email', 'you@company.com', 'email', 'Replies from businesses arrive here.')}${f('phone', 'Phone', '(512) 555-0142', 'tel', 'Typed in the format each form expects.')}</section>
    <section><h5>Your business</h5>${f('company', 'Company')}${f('website', 'Website')}</section>
    <section><h5>Address</h5><span class="help" style="margin-top:-4px">Only typed in when a form asks for an address. Leave it empty and each form gets the city, state and ZIP of the business you're contacting, so you look local. The street is a placeholder.</span>${f('address', 'Street')}<div class="fsrow2">${f('city', 'City')}${f('state', 'State')}</div>${f('zip', 'ZIP code')}</section>
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
  if (!t.closest('.kebab')) { document.querySelectorAll('.oi .menu').forEach(m => m.remove()); if (CMENU.open) { CMENU.open = false; const c0 = curCampaign(); const el = A.$('#c-actions'); if (c0 && el) el.innerHTML = actionsHTML(c0); } }
  const cpy = t.closest('[data-copy]');
  if (cpy) { try { await navigator.clipboard.writeText(cpy.dataset.copy); const s = cpy.querySelector('span'); s.textContent = 'Copied'; setTimeout(() => { s.textContent = 'Copy'; }, 1400); } catch { A.toast('Copy failed. Select the text instead.', 'alert'); } return; }
  const tag = t.closest('[data-tag]');
  if (tag) { insertTag(tag.dataset.tag); return; }
  const ldr = t.closest('[data-ldreplied]');
  if (ldr) { try { await A.api('POST', `/api/outreach/${+ldr.dataset.ldreplied}`, { action: 'replied' }); A.toast('Marked replied. Follow-ups stopped.'); A.sync(); loadOutreach(); setTimeout(() => { const L = A.ST.byId.get(+document.querySelector('#ld-out')?.dataset.lid); if (L) A.openLead(L.id); }, 700); } catch (err) { A.toast(err.message, 'alert'); } return; }
  const sst = t.closest('[data-seqstep]');
  if (sst) { const c = curCampaign(); await flushSave(); flushSteps(); cp(c.id).step = +sst.dataset.seqstep; A.$('#c-tab').innerHTML = tabHTML(c); renderPreview(c); return; }
  const stch = t.closest('[data-stch]');
  if (stch) { const c = curCampaign(), st = c.steps.find(x => x.step === cp(c.id).step); queueSteps(c, true); st.channel = stch.dataset.stch; A.$('#c-tab').innerHTML = tabHTML(c); renderPreview(c); return; }
  const pbn = t.closest('[data-pbnote]');
  if (pbn) { const c = curCampaign(), n = NT.notes.find(x => x.id === +pbn.dataset.pbnote), P = cp(c.id); A.closeOverlay();
    if (P.step === 1) { A.$('#m-subj').value = n.subject || A.$('#m-subj').value; A.$('#m-body').value = n.body; queueSave(c); }
    else { const st = c.steps.find(x => x.step === P.step); st.subject = n.subject || st.subject; st.message = n.body; A.$('#c-tab').innerHTML = tabHTML(c); queueSteps(c, true); }
    renderPreview(c); A.toast(`Used “${n.title || 'note'}”`); return; }
  const tab = t.closest('[data-ctab]');
  if (tab) { const c = curCampaign(); if (!c) return; await flushSave(); flushSteps(); cp(c.id).tab = tab.dataset.ctab; A.render(); return; }
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
  const mqc = t.closest('[data-mqcall]');
  if (mqc) { mqAction('call', mqc.dataset.mqcall); return; }
  const mqa = t.closest('[data-mqact]');
  if (mqa) { mqAction(mqa.dataset.mqact); return; }
  const nrow = t.closest('[data-note]');
  if (nrow) { if (ntDrag.justDropped) return; await ntFlush(); openNote(+nrow.dataset.note); return; }
  const ntg = t.closest('[data-nttag]');
  if (ntg) { NT.tag = ntg.dataset.nttag; A.render(); return; }
  const ntt = t.closest('[data-notetag]');
  if (ntt) { await ntFlush({ tag: ntt.dataset.notetag }); const n = NT.notes.find(x => x.id === NT.sel); if (n) n.tag = ntt.dataset.notetag; document.querySelectorAll('[data-notetag]').forEach(x => x.classList.toggle('on', x === ntt)); document.querySelectorAll('.sheet .tape').forEach(t => t.style.setProperty('--tape', tagOf(ntt.dataset.notetag)[2])); A.$('#nt-list') && (A.$('#nt-list').innerHTML = ntList()); return; }
  const nmt = t.closest('[data-ntag]');
  if (nmt) { const el = A.$(ntLast === 'nt-subj' ? '#nt-subj' : '#nt-body'); const s0 = el.selectionStart ?? el.value.length, e0 = el.selectionEnd ?? s0; el.value = el.value.slice(0, s0) + nmt.dataset.ntag + el.value.slice(e0); el.focus(); el.setSelectionRange(s0 + nmt.dataset.ntag.length, s0 + nmt.dataset.ntag.length); ntQueueSave(); return; }
  const row = t.closest('.oi-click');
  if (row && !t.closest('a,button,.menu')) { openFor = +row.dataset.camp; A.openLead(+row.dataset.olead); return; }
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
    case 'launchmanual': {
      b.disabled = true;
      try { const r = await A.api('POST', `/api/campaigns/${c.id}/status`, { status: 'active' }); upsertCampaign(r.campaign); await loadOutreach(); A.render(); A.toast(`Launched. ${A.fmt(r.campaign.counts.manual)} form${r.campaign.counts.manual === 1 ? ' is' : 's are'} waiting in your Manual queue.`); }
      catch (err) { A.toast(err.message, 'alert'); b.disabled = false; }
      break;
    }
    case 'toqueue': MQ.camp = c.id; MQ.reason = 'all'; MQ.loaded = false; break;
    case 'pause': {
      b.disabled = true;
      try { const r = await A.api('POST', `/api/campaigns/${c.id}/status`, { status: 'paused' }); upsertCampaign(r.campaign); A.render(); A.toast('Paused. Nothing more will be sent.'); }
      catch (err) { A.toast(err.message, 'alert'); b.disabled = false; }
      break;
    }
    case 'test': {
      CMENU.open = false; b.disabled = true;
      try { const r = await A.api('POST', `/api/campaigns/${c.id}/run`, { mode: 'test', count: 10 }); upsertCampaign(r.campaign); cp(c.id).prevJob = { status: 'queued', done: 0 }; refreshCampaignChrome(r.campaign); A.toast('Test run started. It fills up to 10 forms and sends nothing.'); refreshCampaign(c.id).catch(() => {}); }
      catch (err) { A.toast(err.message, 'alert'); b.disabled = false; }
      break;
    }
    case 'sendnow': CMENU.open = false; sendNowModal(c); break;
    case 'cmenu': CMENU.open = !CMENU.open; A.$('#c-actions').innerHTML = actionsHTML(c); break;
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
    case 'testreview': openReview(curCampaign()); break;
    case 'rvskip': rvGo(1); break;
    case 'rvprev': rvGo(-1); break;
    case 'moreitems': loadItems(c.id, true); break;
    case 'extguide': extGuide(); break;
    case 'addstep': { await flushSave(); c.steps = c.steps || []; const n = c.steps.length + 2; c.steps.push({ step: n, channel: 'form', delay_days: 3, subject: '', message: '' }); cp(c.id).step = n; A.$('#c-tab').innerHTML = tabHTML(c); renderPreview(c); queueSteps(c, true); setTimeout(() => A.$('#st-body')?.focus(), 0); break; }
    case 'rmstep': { const P = cp(c.id); clearTimeout(stT); stT = 0; c.steps = c.steps.filter(x => x.step !== P.step).map((x, i) => ({ ...x, step: i + 2 })); P.step = 1; A.$('#c-tab').innerHTML = tabHTML(c); renderPreview(c); await saveSteps(c); A.toast('Step removed. Anything scheduled for it is cancelled.'); break; }
    case 'frombook': playbookPicker(c); break;
    case 'previewfile': { const P = cp(c.id); P.tab = 'message'; P.previewMode = 'file'; A.render(); setTimeout(() => document.querySelector('.pvcard')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100); break; }
    case 'reviewnoconf': { const P = cp(c.id); P.tab = 'leads'; P.filter = 'noconf'; P.items = null; A.render(); break; }
    case 'newnote': {
      try { const r = await A.api('POST', '/api/notes', { title: b.dataset.title || '', tag: b.dataset.ntype || 'idea', body: b.dataset.body || '' }); NT.notes.unshift(r.note); NT.notes.sort(byOrder); NT.tag = 'all'; NT.q = ''; A.render(); openNote(r.note.id); setTimeout(() => (b.dataset.title ? A.$('#nt-body') : A.$('#nt-title'))?.focus(), 0); }
      catch (err) { A.toast(err.message, 'alert'); }
      break;
    }
    case 'pinnote': { const n = NT.notes.find(x => x.id === NT.sel); await ntFlush({ pinned: !n.pinned }); NT.notes.sort(byOrder); b.textContent = NT.notes.find(x => x.id === NT.sel).pinned ? '📌' : '📍'; A.$('#nt-list').innerHTML = ntList(); break; }
    case 'delnote': {
      const n = NT.notes.find(x => x.id === NT.sel);
      A.$('#overlay').innerHTML = `<div class="scrim modal-scrim" data-act="close"><div class="modal" data-stop role="dialog" aria-label="Delete note" style="width:min(420px,100%)"><div class="card-h"><div><h2>Delete “${A.esc(n.title || 'Untitled')}”?</h2><p>This can't be undone. Campaigns that used it keep their message.</p></div></div>
        <div class="card-h" style="border-top:1px solid var(--line);border-bottom:0;justify-content:flex-end"><button class="btn" data-act="close">Cancel</button><button class="btn primary danger-btn" data-o="delnoteok">${A.ic('trash', 14)}Delete</button></div></div></div>`;
      break;
    }
    case 'delnoteok': { ntPending = null; await A.api('DELETE', `/api/notes/${NT.sel}`).catch(() => {}); NT.notes = NT.notes.filter(x => x.id !== NT.sel); NT.sel = NT.notes[0]?.id ?? null; A.closeOverlay(); A.render(); A.toast('Note deleted'); break; }
    case 'notecopy': { const n = NT.notes.find(x => x.id === NT.sel); try { await navigator.clipboard.writeText((n.subject ? n.subject + '\n\n' : '') + n.body); A.toast('Copied'); } catch { A.toast('Copy failed. Select the text instead.', 'alert'); } break; }
    case 'notetocamp': { await ntFlush(); if (!OS.loaded) await loadOutreach(); noteToCampaignModal(NT.notes.find(x => x.id === NT.sel)); break; }
    case 'notetocampok': {
      const n = NT.notes.find(x => x.id === NT.sel), v = document.querySelector('[name="ntcamp"]:checked')?.value; b.disabled = true;
      try {
        let cid;
        if (v === 'new') { const r = await A.api('POST', '/api/campaigns', { name: n.title || 'New campaign', sender_id: OS.senders[0]?.id || null, subject: n.subject || DEFAULT_SUBJECT, message: n.body }); cid = r.campaign.id; upsertCampaign(r.campaign); }
        else { cid = +v; const r = await A.api('PUT', `/api/campaigns/${cid}`, { ...(n.subject ? { subject: n.subject } : {}), message: n.body }); upsertCampaign(r.campaign); }
        A.closeOverlay(); cp(cid).tab = 'message'; location.hash = `#campaign/${cid}`; A.toast('Message added to the campaign');
      } catch (err) { A.$('#ntc-err').textContent = err.message; b.disabled = false; }
      break;
    }
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
    <div class="card-h"><div><h2>Start “${A.esc(c.name)}”</h2><p>Up to ${c.daily_limit} forms a day, ${schedLbl(c)}.</p></div><button class="btn ghost sm" data-act="close" aria-label="Close">${A.ic('x')}</button></div>
    <div class="card-b" style="display:flex;flex-direction:column;gap:10px">
      <label class="opt on" id="st-o1"><input type="radio" name="stwhen" id="st-now" checked><div><b>Start now</b><span>${inWindowNow(c) ? 'The first batch goes out within a few minutes.' : `It's outside your sending hours, so sending begins ${nextWindowLbl(c)}.`}</span></div></label>
      <label class="opt" id="st-o2"><input type="radio" name="stwhen" id="st-later"><div style="flex:1"><b>Schedule a start</b><span>Nothing is sent before this time.</span>
        <div class="st-pick"><input class="input" type="date" id="st-date" min="${today}" value="${tomorrow}" aria-label="Start date"><select class="input" id="st-time" aria-label="Start time">${times.map(t => `<option value="${t}" ${t === `${String(c.window_start).padStart(2, '0')}:00` ? 'selected' : ''}>${tl(t)}</option>`).join('')}</select><span class="st-tz">Los Angeles time</span></div></div></label>
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
    A.toast({ retry: 'Queued again', sent: 'Marked as sent', skip: 'Skipped', remove: 'Removed from the campaign', dnc: 'Marked do not contact', replied: 'Marked replied. Follow-ups stopped.' }[act]);
    await refreshCampaign(c.id, { items: false }); loadItems(c.id); A.sync(); loadOutreach();
  } catch (e) { A.toast(e.message, 'alert'); }
}
let lastField = 'm-body';
function insertTag(tag) {
  const el = A.$('#' + lastField) || A.$('#m-body') || A.$('#st-body'); if (!el) return;
  const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? s;
  el.value = el.value.slice(0, s) + tag + el.value.slice(e); el.focus(); el.setSelectionRange(s + tag.length, s + tag.length);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function onInput(e) {
  const t = e.target, c = curCampaign();
  if (c && ['st-subj', 'st-body', 'st-delay'].includes(t.id)) { lastField = t.id; queueSteps(c); try { renderPreview(c); } catch { /* preview optional */ } return; }
  if (t.id === 'mq-q') { MQ.q = t.value; mqRender(['list', 'detail']); return; }
  if (t.id === 'nt-q') { NT.q = t.value; A.$('#nt-list').innerHTML = ntList(); return; }
  if (['nt-title', 'nt-subj', 'nt-body', 'nt-memo'].includes(t.id)) { ntLast = t.id === 'nt-title' ? ntLast : t.id; ntQueueSave(); return; }
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
  if (t.name === 'ncmode') { document.querySelectorAll('[name="ncmode"]').forEach(r => r.closest('.opt').classList.toggle('on', r.checked)); return; }
  if (t.name === 'smode' && c) { saveSetting(c, { mode: t.value }).then(() => { A.render(); loadOutreach(); }); return; }
  if (t.name === 'stwhen' || t.id === 'st-date' || t.id === 'st-time') { if (t.id === 'st-date' || t.id === 'st-time') A.$('#st-later').checked = true; const later = A.$('#st-later').checked; A.$('#st-o1').classList.toggle('on', !later); A.$('#st-o2').classList.toggle('on', later); A.$('#st-go').textContent = later ? 'Schedule campaign' : 'Start campaign'; return; }
  if (t.id === 'ac-inc') { AC.includeContacted = t.checked; acSummary(); return; }
  if (t.id === 'mq-camp') { MQ.camp = +t.value || 0; mqRender(['list', 'detail']); return; }
}
function onKey(e) {
  if (RV.open && document.querySelector('.rvm')) {
    if (/INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const b = document.querySelector(`.rvm [data-rvkey="${e.key}"]`);
    if (b) { e.preventDefault(); b.click(); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); rvGo(1); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); rvGo(-1); return; }
  }
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
const EVK = { sent: 'Sent', submitted: 'Sent (no confirmation)', sent_manual: 'Sent by you', failed: 'Didn’t go through', manual: 'Moved to your Manual queue', stopped: 'Sequence stopped', call_talked: 'Call: talked', call_voicemail: 'Call: left a voicemail', call_noanswer: 'Call: no answer' };
function seqTimeline(it, L) {
  const total = 1 + (it.steps || []).length;
  if (total < 2 && !(it.events || []).length) return '';
  const rows = (it.events || []).map(e => `<li class="ev-${e.kind.replace(/_.*/, '')}"><b>Step ${e.step}</b> ${EVK[e.kind] || e.kind}${e.detail && !/^Call:/.test(e.detail) ? ` <span>“${A.esc(e.detail.slice(0, 80))}”</span>` : ''}<small>${A.esc(A.whenPT(e.at).replace(' PT', ''))}</small></li>`);
  const nextSt = (it.steps || []).find(x => x.step === it.step);
  if (it.next_at && nextSt) rows.push(`<li class="ev-next"><b>Step ${it.step}</b> ${nextSt.channel === 'call' ? 'Call' : 'Follow-up'} scheduled<small>${A.esc(A.whenPT(it.next_at).replace(' PT', ''))}</small></li>`);
  else if (L.status === 4 && total > 1) rows.push(`<li class="ev-stopped"><b>Replied</b> follow-ups stopped</li>`);
  return rows.length ? `<div class="ldo-tl"><h6>Sequence${total > 1 ? ` · ${total} steps` : ''}</h6><ul>${rows.join('')}</ul></div>` : '';
}
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
          ${seqTimeline(it, L)}
          <div class="row" style="justify-content:space-between">${SENT.concat('manual').includes(it.status) && L.status !== 4 && L.status !== 3 ? `<button class="btn sm" data-ldreplied="${it.id}">${A.ic('messages', 13)}Mark replied${it.steps && it.steps.length ? ' (stops follow-ups)' : ''}</button>` : '<span></span>'}<a class="linkbtn muted" href="#campaign/${it.campaign_id}">Open campaign</a></div>
        </div></details>`;
    }).join('')}</div>`;
  } catch { el.innerHTML = ''; }
}

/* ------------------------------------------------------------------ install */
export function install(ctx) {
  A = ctx;
  // The old #messages address still works and lands on the Playbook.
  Object.assign(ctx.V, { campaigns: campaignsView, campaign: campaignView, manual: manualView, playbook: messagesView, messages: () => { setTimeout(() => { location.replace('#playbook'); }, 0); return loading(); }, senders: sendersView });
  Object.assign(ctx.MOUNT, {
    campaign: mountCampaign,
    campaigns: () => { if (!pollT && OS.loaded && OS.campaigns.some(c => jobActive(c.job))) pollT = setInterval(() => loadOutreach().then(() => A.currentView() === 'campaigns' && A.render()), 6000); },
    manual: () => { if (MQ.loaded && !MQ.fresh) { MQ.fresh = true; loadManual().then(() => { MQ.fresh = false; }); } },
    playbook: () => { if (NT.loaded && !NT.fresh && !document.querySelector('.sheet')) { NT.fresh = true; loadNotes().then(() => { NT.fresh = false; }); } },
  });
  Object.assign(ctx.TITLES, { campaigns: 'Campaigns', campaign: 'Campaign', manual: 'Manual queue', playbook: 'Playbook', messages: 'Playbook', senders: 'Sender profiles' });
  ctx.CRUMBS.campaign = (arg) => { const c = OS.campaigns.find(x => x.id === +arg); return `<a href="#campaigns">Campaigns</a><span>›</span><b>${A.esc(c ? c.name : 'Campaign')}</b>`; };
  ctx.NAV_ACTIVE.campaign = 'campaigns';
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('focusin', onFocus);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', ntPointerDown);
  document.addEventListener('pointermove', ntPointerMove);
  document.addEventListener('pointerup', ntPointerUp);
  document.addEventListener('pointercancel', ntPointerUp);
  document.addEventListener('touchmove', (e) => { if (ntDrag.started || ntDrag.armed && ntDrag.card) e.preventDefault(); }, { passive: false });
  window.addEventListener('hashchange', () => { stopPoll(); flushSave(); ntFlush(); flushSteps(); });
  document.addEventListener('lh-ext-ready', () => { if (A.currentView() === 'manual' && MQ.loaded) A.render(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && A.currentView() === 'manual' && MQ.loaded && !MQ.fresh) { MQ.fresh = true; loadManual().then(() => { MQ.fresh = false; }); loadOutreach(); } });
  window.addEventListener('beforeunload', () => { if (pendingSave) navigator.sendBeacon && flushSave(); });
}
export const outreachNav = () => [['campaigns', 'Campaigns', 'campaigns'], ['manual', 'Manual queue', 'manual', OS.manual], ['playbook', 'Playbook', 'playbook'], ['senders', 'Sender profiles', 'senders']];


/* ------------------------------------------------------------------ review test results (the accuracy answer key) */
const RV = { open: false, list: [], i: 0, done: 0 };
const RV_Q = {
  ready: ['Did the robot fill the right form correctly?', [['right', 'Yes, right form and fields'], ['wrong_fields', 'Some fields wrong or empty'], ['not_contact', 'Not the contact form']]],
  captcha: ['Is there a CAPTCHA a person has to solve?', [['captcha_ok', 'Yes, there is'], ['captcha_wrong', 'No CAPTCHA here']]],
  none: ['Is there really no contact form here?', [['correct_none', 'Right, no form'], ['missed_form', 'There is a form']]],
};
const rvKind = it => it.test_status === 'ready' ? 'ready' : it.test_reason === 'captcha' ? 'captcha' : 'none';
async function openReview(c) {
  if (!c) return;
  RV.open = true; RV.cid = c.id; RV.list = []; RV.i = 0; RV.done = 0;
  rvRender();
  try {
    const r = await A.api('GET', `/api/outreach/items?campaign=${c.id}&test=1&limit=500`);
    RV.list = r.items.filter(i => i.shot_at).sort((a, b) => (a.review ? 1 : 0) - (b.review ? 1 : 0));
  } catch (e) { A.toast(e.message, 'alert'); }
  rvRender();
}
function rvGo(d) { RV.i = Math.max(0, Math.min(RV.list.length, RV.i + d)); rvRender(); }
async function rvVerdict(v) {
  const it = RV.list[RV.i]; if (!it) return;
  try { const r = await A.api('POST', `/api/outreach/${it.id}/review`, { review: v }); if (!it.review) RV.done++; it.review = v; RV.score = r; } catch (e) { A.toast(e.message, 'alert'); return; }
  rvGo(1);
}
function rvRender() {
  const it = RV.list[RV.i], n = RV.list.length;
  const head = `<div class="rv-h"><div><h2>Review test results</h2><p>${n ? `${Math.min(RV.i + 1, n)} of ${n} · ${RV.list.filter(x => x.review).length} checked` : 'Loading…'}</p></div><button class="btn ghost sm" data-act="close" aria-label="Close">${A.ic('x')}</button></div>`;
  let body;
  if (!n) body = `<div class="rv-empty">${RV.list === null ? '' : '<span class="spin"></span>'}</div>`;
  else if (!it) body = `<div class="rv-empty"><b>All checked</b><span>Thanks. Your answers set the form detection and field accuracy on the Usage page scorecard.</span><button class="btn primary" data-act="close">Done</button></div>`;
  else {
    const k = rvKind(it), [q, opts] = RV_Q[k];
    const said = k === 'ready' ? `Filled the form, ready to send${it.evidence ? `: ${A.esc(it.evidence.replace(/^Filled /, '').replace(/, ready.*$/, ''))}` : ''}` : k === 'captcha' ? 'Found a CAPTCHA, so it would go to your Manual queue' : `Found no usable contact form${it.test_reason && it.test_reason !== 'no-form' ? ` (${A.esc(reasonText(it.test_reason))})` : ''}`;
    body = `<div class="rv-b">
      <div class="rv-shot"><img src="/api/outreach/${it.id}/shot" alt="What the robot saw on ${A.esc(it.name)}"></div>
      <div class="rv-side">
        <div><b class="rv-name">${A.esc(it.name)}</b><a class="rv-site" href="${A.esc(it.form_url || it.website || '#')}" target="_blank" rel="noopener noreferrer">${A.esc(domain(it.form_url || it.website))} ${A.ic('ext', 12)}</a></div>
        <div class="rv-said"><span>The robot says</span><b>${said}</b></div>
        ${k === 'ready' && it.answers ? `<div class="rv-ans"><span>Extra answers it chose</span><p>${A.esc(it.answers)}</p></div>` : ''}
        <div class="rv-q"><span>${q}</span>${opts.map(([v, l], i) => `<button class="btn ${it.review === v ? 'primary' : ''}" data-rv="${v}" data-rvkey="${i + 1}"><kbd>${i + 1}</kbd>${l}</button>`).join('')}</div>
        <p class="help">The picture shows the page as the robot left it. Open the site if you're unsure.</p>
        <div class="rv-nav"><button class="btn ghost sm" data-o="rvprev" ${RV.i ? '' : 'disabled'}>${A.ic('back', 13)}Back</button><button class="btn ghost sm" data-o="rvskip">Skip ${A.ic('arrow', 13)}</button></div>
      </div></div>`;
  }
  A.$('#overlay').innerHTML = `<div class="scrim modal-scrim" data-act="close"><div class="modal rvm" data-stop role="dialog" aria-label="Review test results">${head}${body}</div></div>`;
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-rv]'); if (b && RV.open) rvVerdict(b.dataset.rv); });
