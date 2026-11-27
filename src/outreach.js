// Outreach: sender profiles, campaigns, the send queue, the manual queue and the runner endpoints for form sending.
import { isSocialHost } from '../public/shared/normalize.js';
import { json, HttpError, reserveSeq, dispatch, ptMidnight, chunk, inList, LEAD_COLS } from './worker.js';

const now = () => Date.now();
import { BATCH, TOOL_CAP, rampCap, paceAllowance, allowedNow } from './pacing.js';
const TEST_MAX = 25;
const SENT = ['sent', 'submitted', 'sent_manual'];
const STATUSES = ['queued', 'sending', 'sent', 'submitted', 'manual', 'sent_manual', 'failed', 'skipped'];
const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const STOP = '(SELECT id FROM leads WHERE status IN (3,4))';   // do not contact, replied: sequences stop
const ptDay = t => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).format(new Date(t)));
/** t plus n business days (Mon–Fri, Los Angeles), same time of day. */
const PT_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' });
const ptHour = (t) => +PT_HOUR.format(new Date(t));
/** n business days later, at the same Pacific clock time (a day is 23 or 25 hours across daylight-saving changes). */
export function addBizDays(t, n) {
  let d = t, left = Math.max(0, n); if (!left) return t;
  const h0 = ptHour(t);
  while (left > 0) {
    d += 864e5;
    const dh = ptHour(d) - h0; if (dh) d -= (dh > 12 ? dh - 24 : dh < -12 ? dh + 24 : dh) * 36e5;
    const w = ptDay(d); if (w !== 0 && w !== 6) left--;
  }
  return d;
}
async function stepsOf(env, cid) { return (await env.DB.prepare('SELECT * FROM campaign_steps WHERE campaign_id = ? ORDER BY step').bind(cid).all()).results; }
async function logEvent(env, o, kind, detail = null) {
  await env.DB.prepare('INSERT INTO outreach_events (outreach_id, lead_id, campaign_id, step, kind, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(o.id, o.lead_id, o.campaign_id, o.step || 1, kind, detail ? String(detail).slice(0, 300) : null, now()).run();
}
/** A step went out: log it, then schedule the next step (unless the lead replied or asked not to be contacted). */
async function afterSent(env, oid, kind, detail) {
  const o = await env.DB.prepare('SELECT o.*, l.status AS lead_status FROM outreach o JOIN leads l ON l.id = o.lead_id WHERE o.id = ?').bind(oid).first();
  if (!o) return;
  await logEvent(env, o, kind, detail);
  const next = [3, 4].includes(o.lead_status) ? null : await env.DB.prepare('SELECT delay_days FROM campaign_steps WHERE campaign_id = ? AND step = ?').bind(o.campaign_id, (o.step || 1) + 1).first();
  if (next) await env.DB.prepare('UPDATE outreach SET step = step + 1, next_at = ?, prev_status = NULL WHERE id = ?').bind(addBizDays(now(), next.delay_days), oid).run();
  else await env.DB.prepare('UPDATE outreach SET next_at = NULL, prev_status = NULL WHERE id = ?').bind(oid).run();
}
/** Stop every sequence for these leads (they replied, or asked not to be contacted). */
export async function stopSequences(env, leadIds, why) {
  for (const part of chunk(leadIds, 90)) {
    const L = inList(part.length);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO outreach_events (outreach_id, lead_id, campaign_id, step, kind, detail, at) SELECT id, lead_id, campaign_id, step, 'stopped', ?, ? FROM outreach WHERE lead_id IN (${L}) AND (next_at IS NOT NULL OR (status = 'manual' AND step > 1))`).bind(why, now(), ...part),
      env.DB.prepare(`UPDATE outreach SET status = COALESCE(prev_status, 'sent'), reason = NULL, prev_status = NULL WHERE lead_id IN (${L}) AND status = 'manual' AND step > 1`).bind(...part),
      env.DB.prepare(`UPDATE outreach SET next_at = NULL WHERE lead_id IN (${L}) AND next_at IS NOT NULL`).bind(...part),
    ]);
  }
}

/* ------------------------------------------------------------------ overview */
export async function outreachOverview(env) {
  const today = ptMidnight();
  const [snd, cmp, stats, todayQ, manual, jobs, stp, sq] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM senders WHERE archived = 0 ORDER BY id'),
    env.DB.prepare("SELECT * FROM campaigns WHERE status != 'archived' ORDER BY id DESC"),
    env.DB.prepare('SELECT campaign_id, status, COUNT(*) AS n FROM outreach GROUP BY campaign_id, status'),
    env.DB.prepare(`SELECT campaign_id, COUNT(*) AS n FROM outreach WHERE sent_at >= ? AND status IN ('sent','submitted','sent_manual') GROUP BY campaign_id`).bind(today),
    env.DB.prepare("SELECT COUNT(*) AS n FROM outreach o JOIN campaigns c ON c.id = o.campaign_id WHERE o.status = 'manual' AND c.status = 'active'"),
    env.DB.prepare("SELECT id, campaign_id, status, params, to_check, checked, created_at, started_at, finished_at, error, run_url FROM searches WHERE kind = 'outreach' AND id IN (SELECT MAX(id) FROM searches WHERE kind = 'outreach' GROUP BY campaign_id)"),
    env.DB.prepare('SELECT * FROM campaign_steps ORDER BY campaign_id, step'),
    env.DB.prepare('SELECT o.campaign_id, SUM(o.next_at IS NOT NULL) AS sched, SUM(l.status = 4) AS replied, SUM(o.shot_at IS NOT NULL AND o.review IS NULL) AS to_review FROM outreach o JOIN leads l ON l.id = o.lead_id GROUP BY o.campaign_id'),
  ]);
  const stepsBy = {}; for (const r of stp.results) (stepsBy[r.campaign_id] ||= []).push(r);
  const seqBy = Object.fromEntries(sq.results.map(r => [r.campaign_id, r]));
  const by = {};
  for (const r of stats.results) (by[r.campaign_id] ||= {})[r.status] = r.n;
  const td = Object.fromEntries(todayQ.results.map(r => [r.campaign_id, r.n]));
  const jb = Object.fromEntries(jobs.results.map(j => [j.campaign_id, jobOut(j)]));
  return json({
    senders: snd.results.map(senderOut),
    campaigns: cmp.results.map(c => campaignOut(c, by[c.id] || {}, td[c.id] || 0, jb[c.id] || null, stepsBy[c.id] || [], seqBy[c.id] || {})),
    manual: manual.results[0].n,
    limits: await limitsSummary(env),
    alerts: await healthAlerts(env),
  });
}
function jobOut(j) {
  let mode = 'send'; try { mode = JSON.parse(j.params).mode || 'send'; } catch { /* default */ }
  return { id: j.id, status: j.status, mode, total: j.to_check, done: j.checked, created_at: j.created_at, started_at: j.started_at, finished_at: j.finished_at, error: j.error, run_url: j.run_url };
}
const stepOut = s => ({ step: s.step, channel: s.channel, delay_days: s.delay_days, subject: s.subject, message: s.message });
const senderOut = s => ({ id: s.id, label: s.label, first_name: s.first_name, last_name: s.last_name, email: s.email, phone: s.phone, company: s.company, website: s.website, address: s.address, city: s.city, state: s.state, zip: s.zip, country: s.country });
function campaignOut(c, counts = {}, today = 0, job = null, steps = [], seq = {}) {
  const n = k => counts[k] || 0;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    id: c.id, name: c.name, sender_id: c.sender_id, subject: c.subject, message: c.message, file_template: c.file_template,
    daily_limit: c.daily_limit, window_start: c.window_start, window_end: c.window_end, weekdays: c.weekdays, status: c.status, mode: c.mode || 'auto', start_at: c.start_at || null, msg_version: c.msg_version || 1,
    created_at: c.created_at, updated_at: c.updated_at, today, job,
    counts: { total, queued: n('queued'), sending: n('sending'), sent: n('sent'), submitted: n('submitted'), sent_manual: n('sent_manual'), manual: n('manual'), failed: n('failed'), skipped: n('skipped'), scheduled: seq.sched || 0, replied: seq.replied || 0, to_review: seq.to_review || 0 },
    steps: steps.map(stepOut),
  };
}
async function campaignById(env, id) {
  const today = ptMidnight();
  const [c, st, td, jb, stp, sq] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id),
    env.DB.prepare('SELECT status, COUNT(*) AS n FROM outreach WHERE campaign_id = ? GROUP BY status').bind(id),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM outreach WHERE campaign_id = ? AND sent_at >= ? AND status IN ('sent','submitted','sent_manual')`).bind(id, today),
    env.DB.prepare("SELECT id, campaign_id, status, params, to_check, checked, created_at, started_at, finished_at, error, run_url FROM searches WHERE kind = 'outreach' AND campaign_id = ? ORDER BY id DESC LIMIT 1").bind(id),
    env.DB.prepare('SELECT * FROM campaign_steps WHERE campaign_id = ? ORDER BY step').bind(id),
    env.DB.prepare('SELECT SUM(o.next_at IS NOT NULL) AS sched, SUM(l.status = 4) AS replied, SUM(o.shot_at IS NOT NULL AND o.review IS NULL) AS to_review FROM outreach o JOIN leads l ON l.id = o.lead_id WHERE o.campaign_id = ?').bind(id),
  ]);
  const row = c.results[0];
  if (!row) throw new HttpError(404, 'Campaign not found.');
  const out = campaignOut(row, Object.fromEntries(st.results.map(r => [r.status, r.n])), td.results[0].n, jb.results[0] ? jobOut(jb.results[0]) : null, stp.results, sq.results[0] || {});
  return out;
}
export async function getCampaign(env, id) { return json({ campaign: await campaignById(env, id) }); }

/* ------------------------------------------------------------------ senders */
export async function saveSender(env, b, id) {
  const v = {
    label: str(b.label, 60), first_name: str(b.first_name, 60), last_name: str(b.last_name, 60), email: str(b.email, 120), phone: str(b.phone, 40),
    company: str(b.company, 120), website: str(b.website, 200), address: str(b.address, 200), city: str(b.city, 80), state: str(b.state, 40), zip: str(b.zip, 20), country: str(b.country, 60) || 'United States',
  };
  if (!v.first_name || !v.last_name) throw new HttpError(400, 'Add a first and last name. Forms ask for them.');
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v.email)) throw new HttpError(400, 'Add a valid email address. Replies go there.');
  if (v.phone.replace(/\D/g, '').length < 7) throw new HttpError(400, 'Add a phone number. Many forms require one.');
  v.label ||= v.company || `${v.first_name} ${v.last_name}`;
  const cols = Object.keys(v);
  if (id) await env.DB.prepare(`UPDATE senders SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ?`).bind(...Object.values(v), id).run();
  else id = (await env.DB.prepare(`INSERT INTO senders (${cols.join(', ')}, created_at) VALUES (${inList(cols.length)}, ?) RETURNING id`).bind(...Object.values(v), now()).first()).id;
  return json({ sender: senderOut(await env.DB.prepare('SELECT * FROM senders WHERE id = ?').bind(id).first()) });
}
export async function archiveSender(env, id) {
  const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM campaigns WHERE sender_id = ? AND status = 'active'").bind(id).first();
  if (used.n) throw new HttpError(409, 'An active campaign uses this profile. Pause the campaign or pick another profile first.');
  await env.DB.prepare('UPDATE senders SET archived = 1 WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

/* ------------------------------------------------------------------ campaigns */
const TEMPLATES = ['bat-marketing'];
export async function saveCampaign(env, b, id) {
  const cur = id ? await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first() : null;
  if (id && !cur) throw new HttpError(404, 'Campaign not found.');
  const v = {
    name: b.name !== undefined ? str(b.name, 80) : cur?.name, sender_id: b.sender_id !== undefined ? (+b.sender_id || null) : cur?.sender_id ?? null,
    subject: b.subject !== undefined ? str(b.subject, 200) : cur?.subject ?? '', message: b.message !== undefined ? String(b.message ?? '').slice(0, 5000) : cur?.message ?? '',
    file_template: TEMPLATES.includes(b.file_template) ? b.file_template : cur?.file_template || 'bat-marketing',
    mode: ['auto', 'manual'].includes(b.mode) ? b.mode : cur?.mode || 'auto',
    daily_limit: b.daily_limit !== undefined ? Math.max(1, Math.min(2000, Math.floor(+b.daily_limit || 0))) : cur?.daily_limit ?? 100,
    window_start: b.window_start !== undefined ? Math.max(0, Math.min(23, Math.floor(+b.window_start))) : cur?.window_start ?? 8,
    window_end: b.window_end !== undefined ? Math.max(1, Math.min(24, Math.floor(+b.window_end))) : cur?.window_end ?? 18,
    weekdays: b.weekdays !== undefined ? [...new Set(String(b.weekdays).replace(/[^0-6]/g, ''))].sort().join('') : cur?.weekdays ?? '12345',
  };
  if (!v.name) throw new HttpError(400, 'Give the campaign a name.');
  if (v.window_end <= v.window_start) throw new HttpError(400, 'The sending window must end after it starts.');
  if (!v.weekdays) throw new HttpError(400, 'Pick at least one sending day.');
  if (v.sender_id && !(await env.DB.prepare('SELECT id FROM senders WHERE id = ? AND archived = 0').bind(v.sender_id).first())) throw new HttpError(400, 'That sender profile no longer exists.');
  if (cur?.status === 'active') checkReady(v);
  if (cur && (v.subject !== cur.subject || v.message !== cur.message)) v.msg_version = (cur.msg_version || 1) + 1;
  const cols = Object.keys(v);
  if (id) await env.DB.prepare(`UPDATE campaigns SET ${cols.map(c => c + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`).bind(...Object.values(v), now(), id).run();
  else id = (await env.DB.prepare(`INSERT INTO campaigns (${cols.join(', ')}, created_at, updated_at) VALUES (${inList(cols.length)}, ?, ?) RETURNING id`).bind(...Object.values(v), now(), now()).first()).id;
  // Switching mode moves waiting leads: manual → all to the manual queue; auto → back to the robot's queue.
  if (cur && v.mode !== (cur.mode || 'auto')) {
    const t = now();
    if (v.mode === 'manual') await env.DB.batch([
      env.DB.prepare("UPDATE searches SET status = 'cancelled', finished_at = ? WHERE kind = 'outreach' AND campaign_id = ? AND status IN ('queued','running')").bind(t, id),
      env.DB.prepare("UPDATE outreach SET status = 'manual', reason = 'manual', updated_at = ? WHERE campaign_id = ? AND status = 'queued'").bind(t, id),
    ]);
    else await env.DB.prepare("UPDATE outreach SET status = 'queued', reason = NULL, updated_at = ? WHERE campaign_id = ? AND status = 'manual' AND reason = 'manual'").bind(t, id).run();
  }
  return getCampaign(env, id);
}
/** Replace the follow-up steps (2 and 3). Leads that already finished get the new step scheduled. */
export async function saveSteps(env, id, b) {
  const c = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first();
  if (!c) throw new HttpError(404, 'Campaign not found.');
  const steps = (Array.isArray(b.steps) ? b.steps : []).slice(0, 2).map((x, i) => ({
    step: i + 2, channel: x.channel === 'call' ? 'call' : 'form', delay_days: Math.max(1, Math.min(30, Math.floor(+x.delay_days || 3))),
    subject: str(x.subject, 200), message: String(x.message ?? '').slice(0, 5000),
  }));
  const old = await stepsOf(env, id), oldMax = 1 + old.length, newMax = 1 + steps.length, t = now();
  const stmts = [env.DB.prepare('DELETE FROM campaign_steps WHERE campaign_id = ?').bind(id),
    ...steps.map(x => env.DB.prepare('INSERT INTO campaign_steps (campaign_id, step, channel, delay_days, subject, message) VALUES (?, ?, ?, ?, ?, ?)').bind(id, x.step, x.channel, x.delay_days, x.subject, x.message))];
  // Removed steps: cancel what was scheduled for them.
  if (newMax < oldMax) stmts.push(
    env.DB.prepare('UPDATE outreach SET next_at = NULL, step = ? WHERE campaign_id = ? AND step > ? AND next_at IS NOT NULL').bind(newMax, id, newMax),
    env.DB.prepare("UPDATE outreach SET status = COALESCE(prev_status, 'sent'), reason = NULL, step = ? WHERE campaign_id = ? AND step > ? AND status = 'manual'").bind(newMax, id, newMax));
  // Added steps: leads that finished the old last step get the next one (roughly business days, never in the past).
  if (newMax > oldMax) { const nx = steps.find(x => x.step === oldMax + 1); stmts.push(env.DB.prepare(`UPDATE outreach SET step = step + 1, next_at = MAX(?, COALESCE(sent_at, ?) + ?) WHERE campaign_id = ? AND step = ? AND next_at IS NULL AND status IN ('sent','submitted','sent_manual') AND lead_id NOT IN ${STOP}`).bind(t + 6e5, t, Math.round(nx.delay_days * 864e5 * 7 / 5), id, oldMax)); }
  await env.DB.batch(stmts);
  return getCampaign(env, id);
}
function checkReady(c) {
  if (!c.sender_id) throw new HttpError(400, 'Pick a sender profile first. Forms need your name, email and phone.');
  if (!str(c.subject)) throw new HttpError(400, 'Write a subject line first.');
  if (str(c.message, 5000).length < 20) throw new HttpError(400, 'Write the message first.');
}
export async function setCampaignStatus(env, id, b) {
  const c = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first();
  if (!c) throw new HttpError(404, 'Campaign not found.');
  const status = ['active', 'paused', 'archived'].includes(b.status) ? b.status : null;
  if (!status) throw new HttpError(400, 'Unknown status.');
  if (status === 'active') checkReady(c);
  let startAt = null;
  if (status === 'active' && b.start_at) { startAt = Math.floor(+b.start_at); if (!(startAt > now() - 60e3) || startAt > now() + 366 * 864e5) throw new HttpError(400, 'Pick a start time in the future.'); }
  await env.DB.prepare('UPDATE campaigns SET status = ?, start_at = ?, updated_at = ? WHERE id = ?').bind(status, status === 'active' ? startAt : c.start_at, now(), id).run();
  if (status !== 'paused') await env.DB.prepare('DELETE FROM meta WHERE k = ?').bind('autopause:' + id).run();
  c.start_at = startAt;
  if (status !== 'active') await env.DB.prepare("UPDATE searches SET status = 'cancelled', finished_at = ? WHERE kind = 'outreach' AND campaign_id = ? AND status IN ('queued','running')").bind(now(), id).run();
  if (status === 'active') { const e = await tickCampaign(env, { ...c, status }, { ignoreWindow: false }); if (e) throw new HttpError(502, e); }
  return getCampaign(env, id);
}

/** Bump leads' status in the Leads list (it syncs by seq). */
async function setLeadStatus(env, ids, status, onlyFrom = null) {
  ids = [...new Set(ids)].filter(Boolean);
  if (!ids.length) return;
  let seq = await reserveSeq(env, ids.length);
  const t = now();
  const stmts = ids.map(id => env.DB.prepare(`UPDATE leads SET status = ?, seq = ?, updated_at = ? WHERE id = ?${onlyFrom !== null ? ` AND status IN (${onlyFrom.join(',')})` : ''}`).bind(status, seq++, t, id));
  for (const part of chunk(stmts, 400)) await env.DB.batch(part);
}

/** Add leads. With dry: true, only report what would happen (the confirm step in the app). */
export async function addLeads(env, id, b) {
  const c = await env.DB.prepare('SELECT id, status, mode FROM campaigns WHERE id = ?').bind(id).first();
  if (!c || c.status === 'archived') throw new HttpError(404, 'Campaign not found.');
  const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger))].slice(0, 20000);
  if (!ids.length) throw new HttpError(400, 'Select at least one lead.');
  const leads = [];
  for (const part of chunk(ids, 90)) leads.push(...(await env.DB.prepare(`SELECT id, status, website, site_status, form_status, form_url, deleted FROM leads WHERE id IN (${inList(part.length)})`).bind(...part).all()).results);
  const inThis = new Set(), contacted = new Set();
  for (const part of chunk(ids, 90)) {
    for (const r of (await env.DB.prepare(`SELECT lead_id, campaign_id, status FROM outreach WHERE lead_id IN (${inList(part.length)})`).bind(...part).all()).results) {
      if (r.campaign_id === id) inThis.add(r.lead_id);
      if (SENT.includes(r.status)) contacted.add(r.lead_id);
    }
  }
  const out = { add: [], manual: [], skipped: { already: 0, dnc: 0, contacted: 0, noWebsite: 0, profile: 0, noForm: 0 } };
  for (const l of leads) {
    if (l.deleted) continue;
    if (inThis.has(l.id)) out.skipped.already++;
    else if (l.status === 3) out.skipped.dnc++;
    else if (!b.includeContacted && (l.status === 2 || l.status === 4 || contacted.has(l.id))) out.skipped.contacted++;
    else if (!l.website) out.skipped.noWebsite++;
    else if (l.site_status === 7 || (() => { try { return isSocialHost(new URL(l.website).hostname); } catch { return false; } })()) out.skipped.profile++;
    else if (l.form_status === 2) out.skipped.noForm++;
    else if (l.form_status === 1) out.manual.push(l);   // CAPTCHA known from the website check: straight to the manual queue
    else out.add.push(l);
  }
  const summary = { add: c.mode === 'manual' ? 0 : out.add.length, manual: out.manual.length + (c.mode === 'manual' ? out.add.length : 0), captcha: out.manual.length, mode: c.mode || 'auto', skipped: out.skipped };
  if (b.dry) return json(summary);
  const t = now();
  const stmts = [
    ...out.add.map(l => c.mode === 'manual'
      ? env.DB.prepare("INSERT OR IGNORE INTO outreach (campaign_id, lead_id, status, reason, form_url, created_at, updated_at) VALUES (?, ?, 'manual', 'manual', ?, ?, ?)").bind(id, l.id, l.form_url, t, t)
      : env.DB.prepare("INSERT OR IGNORE INTO outreach (campaign_id, lead_id, status, form_url, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?, ?)").bind(id, l.id, l.form_url, t, t)),
    ...out.manual.map(l => env.DB.prepare("INSERT OR IGNORE INTO outreach (campaign_id, lead_id, status, reason, form_url, created_at, updated_at) VALUES (?, ?, 'manual', 'captcha', ?, ?, ?)").bind(id, l.id, l.form_url, t, t)),
  ];
  for (const part of chunk(stmts, 400)) await env.DB.batch(part);
  await setLeadStatus(env, [...out.add, ...out.manual].map(l => l.id), 1, [0]);
  if (c.status === 'active' && c.mode !== 'manual') ctxTick(env, id);
  return json(summary);
}
function ctxTick(env, id) { env.CTX?.waitUntil(env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first().then(c => c && tickCampaign(env, c)).catch(() => {})); }

export async function removeItems(env, id, b) {
  const oids = [...new Set((b.ids || []).map(Number).filter(Number.isInteger))].slice(0, 5000);
  const leadIds = [];
  for (const part of chunk(oids, 90)) {
    const r = await env.DB.prepare(`DELETE FROM outreach WHERE campaign_id = ? AND id IN (${inList(part.length)}) AND status IN ('queued','manual','failed','skipped') RETURNING lead_id`).bind(id, ...part).all();
    leadIds.push(...r.results.map(x => x.lead_id));
  }
  await setLeadStatus(env, leadIds, 0, [1]);
  return json({ removed: leadIds.length });
}

/** Delete a campaign for good. Stops any run, frees leads that were only waiting, keeps contacted leads marked Contacted. */
export async function deleteCampaign(env, id, b) {
  if (String(b.confirm || '') !== 'DELETE') throw new HttpError(400, 'Type DELETE to confirm.');
  const c = await env.DB.prepare('SELECT id FROM campaigns WHERE id = ?').bind(id).first();
  if (!c) throw new HttpError(404, 'Campaign not found.');
  const running = await env.DB.prepare("SELECT id FROM searches WHERE kind = 'outreach' AND campaign_id = ? AND status = 'running'").bind(id).first();
  if (running) throw new HttpError(409, 'A batch is sending right now. Pause the campaign, wait about a minute for the current form to finish, then delete it.');
  const t = now();
  await env.DB.batch([
    env.DB.prepare("UPDATE campaigns SET status = 'archived', updated_at = ? WHERE id = ?").bind(t, id),
    env.DB.prepare("UPDATE searches SET status = 'cancelled', finished_at = ? WHERE kind = 'outreach' AND campaign_id = ? AND status IN ('queued','running')").bind(t, id),
  ]);
  // Leads whose only open place was this campaign go back to New.
  const free = (await env.DB.prepare(`SELECT DISTINCT o.lead_id AS id FROM outreach o JOIN leads l ON l.id = o.lead_id
    WHERE o.campaign_id = ? AND l.status = 1 AND o.status NOT IN ('sent','submitted','sent_manual')
    AND NOT EXISTS (SELECT 1 FROM outreach x WHERE x.lead_id = o.lead_id AND x.campaign_id != ? AND x.status IN ('queued','sending','manual','failed'))`).bind(id, id).all()).results.map(r => r.id);
  await setLeadStatus(env, free, 0, [1]);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM outreach WHERE campaign_id = ?').bind(id),
    env.DB.prepare('DELETE FROM outreach_events WHERE campaign_id = ?').bind(id),
    env.DB.prepare('DELETE FROM campaign_steps WHERE campaign_id = ?').bind(id),
    env.DB.prepare('DELETE FROM campaign_messages WHERE campaign_id = ?').bind(id),
    env.DB.prepare('DELETE FROM campaign_variants WHERE campaign_id = ?').bind(id),
    env.DB.prepare('DELETE FROM meta WHERE k = ?').bind('autopause:' + id),
    env.DB.prepare('UPDATE searches SET campaign_id = NULL WHERE campaign_id = ?').bind(id),
    env.DB.prepare('DELETE FROM campaigns WHERE id = ?').bind(id),
  ]);
  return json({ ok: true, freed: free.length });
}

/* ------------------------------------------------------------------ browser extension: signed, single-item codes */
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function extKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('lh-ext:' + (env.RUNNER_SECRET || '')));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
async function extToken(key, oid, exp) { return `${exp}.${b64u(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${oid}.${exp}`)))}`; }
/** Called by the extension when a site confirms a manual send. Needs a valid code for that one item, no login. */
export async function extSent(env, b) {
  const oid = Math.floor(+b.oid), [exp] = String(b.token || '').split('.');
  if (!oid || !(+exp > now())) throw new HttpError(401, 'This link has expired. Open the form again from the Manual queue.');
  const want = await extToken(await extKey(env), oid, +exp);
  if (want.length !== String(b.token).length || want !== String(b.token)) throw new HttpError(401, 'Not authorised.');
  const o = await env.DB.prepare('SELECT * FROM outreach WHERE id = ?').bind(oid).first();
  if (!o) throw new HttpError(404, 'This item is no longer in LeadsHunter.');
  if (!SENT.includes(o.status)) {
    const t = now();
    await env.DB.prepare("UPDATE outreach SET status = 'sent_manual', reason = NULL, evidence = ?, sent_at = ?, updated_at = ? WHERE id = ?").bind(str(b.evidence, 300) || 'Sent with the extension', t, t, oid).run();
    await setLeadStatus(env, [o.lead_id], 2, [0, 1]);
    await afterSent(env, oid, 'sent_manual', str(b.evidence, 300) || 'Sent with the extension');
  }
  return json({ ok: true });
}

/* ------------------------------------------------------------------ items (campaign results, manual queue, messages) */
export async function listItems(env, url) {
  const q = url.searchParams, where = [], vals = [];
  const cid = +q.get('campaign') || 0;
  if (cid) { where.push('o.campaign_id = ?'); vals.push(cid); }
  const st = (q.get('status') || '').split(',').filter(s => STATUSES.includes(s));
  if (st.length) { where.push(`o.status IN (${inList(st.length)})`); vals.push(...st); }
  if (q.get('test')) where.push('o.test_status IS NOT NULL');
  if (!cid) where.push(st.length === 1 && st[0] === 'manual' ? "c.status = 'active'" : "c.status != 'archived'");   // manual queue: launched campaigns only
  // Campaign lists keep the order leads were added, so rows don't jump while a run updates them.
  const order = q.get('order') === 'sent' ? 'o.sent_at DESC, o.id DESC' : q.get('order') === 'recent' ? 'o.updated_at DESC, o.id DESC' : 'o.id';
  const limit = Math.min(500, +q.get('limit') || 200), offset = Math.max(0, +q.get('offset') || 0);
  const sql = `SELECT o.id, o.campaign_id, o.lead_id, o.status, o.reason, o.evidence, o.form_url, o.test_status, o.test_reason, o.test_at, o.shot_at, o.review, o.answers, o.sent_at, o.updated_at, o.step, o.next_at, l.status AS lead_status,
      l.name, l.website, l.city, l.region, l.postal, l.country, l.phone, l.category, l.industry_id, c.name AS campaign
    FROM outreach o JOIN leads l ON l.id = o.lead_id JOIN campaigns c ON c.id = o.campaign_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ? OFFSET ?`;
  const r = await env.DB.prepare(sql).bind(...vals, limit + 1, offset).all();
  const items = r.results.slice(0, limit);
  if (q.get('tokens')) { const key = await extKey(env), exp = now() + 14 * 864e5; for (const it of items) if (it.status === 'manual') it.fill_token = await extToken(key, it.id, exp); }
  return json({ items, more: r.results.length > limit });
}
export async function itemAction(env, oid, b) {
  const o = await env.DB.prepare('SELECT * FROM outreach WHERE id = ?').bind(oid).first();
  if (!o) throw new HttpError(404, 'Not found.');
  const t = now();
  if (b.action === 'sent' || b.action === 'call') {
    if (SENT.includes(o.status)) return json({ ok: true });
    const CALL = { talked: 'Talked to them', voicemail: 'Left a voicemail', noanswer: 'No answer' };
    const ev = b.action === 'call' ? `Call: ${CALL[b.outcome] || 'Called'}` : null;
    await env.DB.prepare("UPDATE outreach SET status = 'sent_manual', reason = NULL, evidence = COALESCE(?, evidence), sent_at = ?, updated_at = ? WHERE id = ?").bind(ev, t, t, oid).run();
    await setLeadStatus(env, [o.lead_id], 2, [0, 1]);
    await afterSent(env, oid, b.action === 'call' ? `call_${CALL[b.outcome] ? b.outcome : 'talked'}` : 'sent_manual', ev);
  } else if (b.action === 'replied') {
    await setLeadStatus(env, [o.lead_id], 4);
    await skipUnsent(env, [o.lead_id], 4);
  } else if (b.action === 'skip') {
    if (['sending', ...SENT].includes(o.status)) throw new HttpError(409, 'This one is already sent or sending.');
    await env.DB.prepare("UPDATE outreach SET status = 'skipped', reason = COALESCE(reason, 'skipped by you'), updated_at = ? WHERE id = ?").bind(t, oid).run();
    await setLeadStatus(env, [o.lead_id], 0, [1]);
  } else if (b.action === 'retry') {
    if (!['manual', 'failed', 'skipped'].includes(o.status)) throw new HttpError(409, 'Only failed, skipped or manual items can be retried.');
    const cm = await env.DB.prepare('SELECT mode FROM campaigns WHERE id = ?').bind(o.campaign_id).first();
    if (cm && cm.mode === 'manual') throw new HttpError(409, 'This campaign is manual, so the robot doesn’t send its forms. Switch it to automatic in Settings to let the robot send.');
    await env.DB.prepare("UPDATE outreach SET status = 'queued', reason = NULL, evidence = NULL, updated_at = ? WHERE id = ?").bind(t, oid).run();
    await setLeadStatus(env, [o.lead_id], 1, [0]);
    ctxTick(env, o.campaign_id);
  } else if (b.action === 'dnc') {
    if (['sending'].includes(o.status)) throw new HttpError(409, 'This one is sending right now.');
    if (!SENT.includes(o.status)) await env.DB.prepare("UPDATE outreach SET status = 'skipped', reason = 'do not contact', updated_at = ? WHERE id = ?").bind(t, oid).run();
    await setLeadStatus(env, [o.lead_id], 3);
    await stopSequences(env, [o.lead_id], 'do not contact');
  } else throw new HttpError(400, 'Unknown action.');
  return json({ ok: true });
}

/** A lead marked contacted (some other way) or do-not-contact by hand: don't send it anything still waiting. */
export async function skipUnsent(env, leadIds, status) {
  if (![2, 3, 4].includes(status) || !leadIds.length) return;
  if (status !== 2) await stopSequences(env, leadIds, status === 4 ? 'replied' : 'do not contact');
  const reason = status === 3 ? 'do not contact' : status === 4 ? 'replied' : 'already contacted';
  for (const part of chunk(leadIds, 90)) await env.DB.prepare(`UPDATE outreach SET status = 'skipped', reason = ?, updated_at = ? WHERE lead_id IN (${inList(part.length)}) AND status IN ('queued','manual','failed') AND step = 1`).bind(reason, now(), ...part).run();
}
export async function leadOutreach(env, id) {
  const r = await env.DB.prepare(`SELECT o.id, o.campaign_id, c.name AS campaign, o.status, o.reason, o.evidence, o.form_url, o.sent_at, o.updated_at, o.created_at, o.test_status, o.test_reason, o.test_at, o.answers,
      COALESCE(m.subject, c.subject) AS subject, COALESCE(m.message, c.message) AS message, o.msg_version, o.variant, c.sender_id, o.step, o.next_at
    FROM outreach o JOIN campaigns c ON c.id = o.campaign_id LEFT JOIN campaign_messages m ON m.campaign_id = o.campaign_id AND m.version = o.msg_version
    WHERE o.lead_id = ? ORDER BY o.id DESC`).bind(id).all();
  const [ev, st] = await env.DB.batch([
    env.DB.prepare('SELECT outreach_id, step, kind, detail, at FROM outreach_events WHERE lead_id = ? ORDER BY at').bind(id),
    env.DB.prepare('SELECT s.* FROM campaign_steps s WHERE s.campaign_id IN (SELECT campaign_id FROM outreach WHERE lead_id = ?) ORDER BY s.campaign_id, s.step').bind(id),
  ]);
  for (const it of r.results) { it.events = ev.results.filter(e => e.outreach_id === it.id); it.steps = st.results.filter(x => x.campaign_id === it.campaign_id).map(stepOut); }
  return json({ items: r.results });
}

/** The same actions for many manual-queue items at once (max 100 per request). */
export async function bulkItems(env, b) {
  const ids = [...new Set((b.ids || []).map(Number).filter(Number.isInteger))].slice(0, 100);
  if (!ids.length || !['sent', 'skip', 'retry', 'dnc', 'replied'].includes(b.action)) throw new HttpError(400, 'Select items and an action.');
  let done = 0, failed = 0;
  for (const id of ids) { try { await itemAction(env, id, { action: b.action }); done++; } catch { failed++; } }
  return json({ ok: true, done, failed });
}

/* ------------------------------------------------------------------ messages: notes for drafting outreach */
const TAGS = ['idea', 'draft', 'ready', 'flow'];
const noteOut = n => ({ id: n.id, title: n.title, subject: n.subject, body: n.body, memo: n.memo || '', tag: n.tag, pinned: !!n.pinned, position: n.position || 0, created_at: n.created_at, updated_at: n.updated_at });
export async function listNotes(env) { return json({ notes: (await env.DB.prepare('SELECT * FROM notes ORDER BY pinned DESC, position, id DESC LIMIT 500').all()).results.map(noteOut) }); }
export async function saveNote(env, b, id) {
  const cur = id ? await env.DB.prepare('SELECT * FROM notes WHERE id = ?').bind(id).first() : null;
  if (id && !cur) throw new HttpError(404, 'Note not found.');
  const v = {
    title: b.title !== undefined ? str(b.title, 120) : cur?.title ?? '', subject: b.subject !== undefined ? str(b.subject, 200) : cur?.subject ?? '',
    body: b.body !== undefined ? String(b.body ?? '').slice(0, 20000) : cur?.body ?? '', memo: b.memo !== undefined ? String(b.memo ?? '').slice(0, 10000) : cur?.memo ?? '', tag: TAGS.includes(b.tag) ? b.tag : cur?.tag ?? 'idea',
    pinned: b.pinned !== undefined ? (b.pinned ? 1 : 0) : cur?.pinned ?? 0,
  };
  const t = now(), cols = Object.keys(v);
  if (id) await env.DB.prepare(`UPDATE notes SET ${cols.map(c => c + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`).bind(...Object.values(v), t, id).run();
  else id = (await env.DB.prepare(`INSERT INTO notes (${cols.join(', ')}, position, created_at, updated_at) VALUES (${inList(cols.length)}, (SELECT COALESCE(MIN(position), 0) - 1 FROM notes), ?, ?) RETURNING id`).bind(...Object.values(v), t, t).first()).id;  // new notes go first
  return json({ note: noteOut(await env.DB.prepare('SELECT * FROM notes WHERE id = ?').bind(id).first()) });
}
export async function orderNotes(env, b) {
  const ids = [...new Set((b.ids || []).map(Number).filter(Number.isInteger))].slice(0, 500);
  for (const part of chunk(ids.map((id, i) => env.DB.prepare('UPDATE notes SET position = ? WHERE id = ?').bind(i, id)), 100)) await env.DB.batch(part);
  return json({ ok: true });
}
export async function deleteNote(env, id) { await env.DB.prepare('DELETE FROM notes WHERE id = ?').bind(id).run(); return json({ ok: true }); }

/* ------------------------------------------------------------------ lead lists */
export async function getLists(env) {
  const [ls, mem] = await env.DB.batch([
    env.DB.prepare('SELECT l.id, l.name, l.created_at, (SELECT COUNT(*) FROM list_leads x WHERE x.list_id = l.id) AS n FROM lists l ORDER BY l.name COLLATE NOCASE'),
    env.DB.prepare('SELECT list_id, lead_id FROM list_leads'),
  ]);
  const members = {};
  for (const r of mem.results) (members[r.list_id] ||= []).push(r.lead_id);
  return json({ lists: ls.results.map(l => ({ id: l.id, name: l.name, count: l.n, created_at: l.created_at })), members });
}
export async function saveList(env, b, id) {
  const name = str(b.name, 80);
  if (!name) throw new HttpError(400, 'Give the list a name.');
  const t = now();
  if (id) await env.DB.prepare('UPDATE lists SET name = ?, updated_at = ? WHERE id = ?').bind(name, t, id).run();
  else id = (await env.DB.prepare('INSERT INTO lists (name, created_at, updated_at) VALUES (?, ?, ?) RETURNING id').bind(name, t, t).first()).id;
  return json({ list: { id, name } });
}
export async function deleteList(env, id) {
  await env.DB.batch([env.DB.prepare('DELETE FROM list_leads WHERE list_id = ?').bind(id), env.DB.prepare('DELETE FROM lists WHERE id = ?').bind(id)]);
  return json({ ok: true });
}
export async function listLeads(env, id, b) {
  if (!(await env.DB.prepare('SELECT id FROM lists WHERE id = ?').bind(id).first())) throw new HttpError(404, 'List not found.');
  const ids = [...new Set((b.ids || []).map(Number).filter(Number.isInteger))].slice(0, 20000);
  const t = now();
  const stmts = ids.map(l => b.remove ? env.DB.prepare('DELETE FROM list_leads WHERE list_id = ? AND lead_id = ?').bind(id, l) : env.DB.prepare('INSERT OR IGNORE INTO list_leads (list_id, lead_id, added_at) VALUES (?, ?, ?)').bind(id, l, t));
  for (const part of chunk(stmts, 400)) await env.DB.batch(part);
  await env.DB.prepare('UPDATE lists SET updated_at = ? WHERE id = ?').bind(t, id).run();
  return json({ ok: true, count: ids.length });
}

/* ------------------------------------------------------------------ runs */
async function activeJob(env, cid) {
  return env.DB.prepare("SELECT id, status FROM searches WHERE kind = 'outreach' AND campaign_id = ? AND status IN ('queued','running') ORDER BY id DESC LIMIT 1").bind(cid).first();
}
/** Create an outreach job. Send: claims queued rows. Test: marks rows to try without sending. Returns an error string or null. */
async function startJob(env, c, mode, count) {
  if (await activeJob(env, c.id)) return { error: 'A run is already in progress for this campaign.' };
  const t = now();
  const job = await env.DB.prepare("INSERT INTO searches (kind, name, params, status, to_check, created_at, campaign_id) VALUES ('outreach', ?, ?, 'queued', 0, ?, ?) RETURNING id")
    .bind(`${mode === 'test' ? 'Test' : 'Send'}: ${c.name}`.slice(0, 80), JSON.stringify({ mode, campaign_id: c.id }), t, c.id).first();
  let n;
  if (mode === 'test') {
    n = (await env.DB.prepare("UPDATE outreach SET test_job = ?, test_status = NULL, test_reason = NULL WHERE id IN (SELECT id FROM outreach WHERE campaign_id = ? AND status = 'queued' ORDER BY test_at IS NOT NULL, id LIMIT ?)").bind(job.id, c.id, count).run()).meta.changes;
  } else {
    await env.DB.batch([
      env.DB.prepare("UPDATE outreach SET status = 'skipped', reason = 'do not contact', updated_at = ? WHERE campaign_id = ? AND status = 'queued' AND lead_id IN (SELECT id FROM leads WHERE status = 3)").bind(t, c.id),
      env.DB.prepare("UPDATE outreach SET status = 'skipped', reason = 'directory-page', updated_at = ? WHERE campaign_id = ? AND status = 'queued' AND lead_id IN (SELECT id FROM leads WHERE site_status = 7)").bind(t, c.id),
      env.DB.prepare('INSERT OR IGNORE INTO campaign_messages (campaign_id, version, subject, message, created_at) VALUES (?, ?, ?, ?, ?)').bind(c.id, c.msg_version || 1, c.subject, c.message, t),
    ]);
    // Follow-ups that are due go first, so they're never stuck behind new leads.
    const formSteps = (await stepsOf(env, c.id)).filter(x => x.channel === 'form').map(x => x.step);
    let fu = 0;
    if (formSteps.length) fu = (await env.DB.prepare(`UPDATE outreach SET prev_status = status, status = 'sending', job_id = ?, next_at = NULL, attempt_at = NULL, attempts = attempts + 1, updated_at = ? WHERE id IN (SELECT id FROM outreach WHERE campaign_id = ? AND next_at IS NOT NULL AND next_at <= ? AND status IN ('sent','submitted','sent_manual') AND step IN (${formSteps.join(',')}) AND lead_id NOT IN ${STOP} ORDER BY next_at LIMIT ?)`).bind(job.id, t, c.id, t, count).run()).meta.changes;
    n = fu + (count - fu > 0 ? (await env.DB.prepare("UPDATE outreach SET status = 'sending', job_id = ?, msg_version = ?, attempt_at = NULL, attempts = attempts + 1, updated_at = ? WHERE id IN (SELECT id FROM outreach WHERE campaign_id = ? AND status = 'queued' ORDER BY id LIMIT ?)").bind(job.id, c.msg_version || 1, t, c.id, count - fu).run()).meta.changes : 0);
  }
  if (!n) { await env.DB.prepare('DELETE FROM searches WHERE id = ?').bind(job.id).run(); return { error: null, empty: true }; }
  await env.DB.prepare('UPDATE searches SET to_check = ? WHERE id = ?').bind(n, job.id).run();
  const err = await dispatch(env, job.id);
  if (err) {
    await env.DB.batch([
      env.DB.prepare("UPDATE searches SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").bind(err, now(), job.id),
      env.DB.prepare("UPDATE outreach SET status = CASE WHEN step > 1 THEN COALESCE(prev_status, 'sent') ELSE 'queued' END, next_at = CASE WHEN step > 1 THEN ? ELSE next_at END, job_id = NULL WHERE job_id = ? AND status = 'sending'").bind(now(), job.id),
    ]);
    return { error: err };
  }
  return { error: null, id: job.id, n };
}
export async function runCampaign(env, id, b) {
  const c = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first();
  if (!c || c.status === 'archived') throw new HttpError(404, 'Campaign not found.');
  checkReady(c);
  if (c.mode === 'manual' && b.mode !== 'test') throw new HttpError(409, 'This is a manual campaign: its forms are sent from your Manual queue.');
  const mode = b.mode === 'test' ? 'test' : 'send';
  let count = Math.max(1, Math.floor(+b.count || 0));
  if (mode === 'test') count = Math.min(TEST_MAX, count || 10);
  else {
    const L = await limitsFor(env, c);
    if (L.campaignLeft <= 0) throw new HttpError(409, `Today's limit of ${c.daily_limit} is reached. Raise the daily limit in Settings to send more today.`);
    if (L.toolLeft <= 0) throw new HttpError(409, `The tool-wide limit of ${L.toolCap} forms a day is reached. It resets at midnight Pacific.`);
    if (L.senderLeft <= 0) throw new HttpError(409, `This sender profile is warming up (day ${L.warmupDay}): ${L.senderCap} forms today. More tomorrow.`);
    count = Math.min(count || 5, L.campaignLeft, L.senderLeft, L.toolLeft, BATCH * 5);
  }
  const r = await startJob(env, c, mode, count);
  if (r.empty) throw new HttpError(409, 'Nothing queued. Add leads to this campaign first.');
  if (r.error) throw new HttpError(r.error.startsWith('A run') ? 409 : 502, r.error);
  return getCampaign(env, id);
}

/** Scheduler: start the next batch for an active campaign if it's inside its sending window and under today's limit. */
function ptNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { hour: +p.hour, minute: +p.minute, day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
// Forms sent today plus forms in flight, as two index-friendly counts (an OR here would read the whole table on every tick).
const sentSince = (filter = '') => `((SELECT COUNT(*) FROM outreach o WHERE o.sent_at >= ? AND o.status IN ('sent','submitted','sent_manual')${filter}) + (SELECT COUNT(*) FROM outreach o WHERE o.status = 'sending'${filter}))`;
/** Tool-wide sending settings: the daily cap across all campaigns and the warm-up for new sender profiles. */
export async function outreachSettings(env) {
  let v = {}; try { v = JSON.parse((await env.DB.prepare("SELECT v FROM meta WHERE k = 'outreach_settings'").first())?.v || '{}'); } catch { /* defaults */ }
  return { daily_cap: Number.isFinite(+v.daily_cap) && +v.daily_cap > 0 ? Math.min(5000, Math.floor(+v.daily_cap)) : TOOL_CAP, ramp: v.ramp !== false };
}
export async function saveOutreachSettings(env, b) {
  const cur = await outreachSettings(env);
  const next = { daily_cap: b.daily_cap !== undefined ? Math.max(1, Math.min(5000, Math.floor(+b.daily_cap || 0))) : cur.daily_cap, ramp: b.ramp !== undefined ? !!b.ramp : cur.ramp };
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('outreach_settings', ?)").bind(JSON.stringify(next)).run();
  return json({ settings: next, ...(await limitsSummary(env)) });
}
/** Every limit that applies to a campaign right now: its own, its sender profile's warm-up, and the tool-wide cap. */
async function limitsFor(env, c) {
  const day = ptMidnight(), set = await outreachSettings(env);
  const inSender = ' AND o.campaign_id IN (SELECT id FROM campaigns WHERE sender_id = ?)';
  const [camp, snd, tool] = await env.DB.batch([
    env.DB.prepare(`SELECT ${sentSince(' AND o.campaign_id = ?')} AS n`).bind(day, c.id, c.id),
    env.DB.prepare(`SELECT ${sentSince(inSender)} AS n, (SELECT MIN(o2.sent_at) FROM outreach o2 WHERE o2.sent_at IS NOT NULL AND o2.campaign_id IN (SELECT id FROM campaigns WHERE sender_id = ?)) AS first`).bind(day, c.sender_id, c.sender_id, c.sender_id),
    env.DB.prepare(`SELECT ${sentSince()} AS n`).bind(day),
  ]);
  const campSent = camp.results[0].n, sndSent = snd.results[0].n, first = snd.results[0].first, toolSent = tool.results[0].n;
  const days = first ? Math.floor((day - ptMidnight(new Date(first))) / 864e5) : null;
  const senderCap = set.ramp ? rampCap(days) : Infinity;
  return { campSent, campaignLeft: c.daily_limit - campSent, senderCap, senderLeft: senderCap - sndSent, toolCap: set.daily_cap, toolLeft: set.daily_cap - toolSent, warmupDay: days == null ? 1 : days + 1 };
}
export async function limitsSummary(env) {
  const day = ptMidnight(), set = await outreachSettings(env);
  const tool = (await env.DB.prepare(`SELECT ${sentSince()} AS n`).bind(day).first()).n;
  const senders = [];
  for (const sd of (await env.DB.prepare('SELECT id FROM senders WHERE archived = 0').all()).results) {
    const inS = ' AND o.campaign_id IN (SELECT id FROM campaigns WHERE sender_id = ?)';
    const r = await env.DB.prepare(`SELECT ${sentSince(inS)} AS today, (SELECT MIN(o2.sent_at) FROM outreach o2 WHERE o2.sent_at IS NOT NULL AND o2.campaign_id IN (SELECT id FROM campaigns WHERE sender_id = ?)) AS first`).bind(day, sd.id, sd.id, sd.id).first();
    senders.push({ id: sd.id, today: r.today, first: r.first });
  }
  return { tool: { cap: set.daily_cap, today: tool, ramp: set.ramp }, senders: senders.map(x => { const days = x.first ? Math.floor((day - ptMidnight(new Date(x.first))) / 864e5) : null, cap = set.ramp ? rampCap(days) : null; return { id: x.id, today: x.today, cap: cap === Infinity ? null : cap, warmup_day: cap && cap !== Infinity ? (days == null ? 1 : days + 1) : null }; }) };
}
export function inWindow(c) { const { hour, day } = ptNow(); return c.weekdays.includes(String(day)) && hour >= c.window_start && hour < c.window_end; }
async function tickCampaign(env, c) {
  if (c.status !== 'active' || c.mode === 'manual' || !inWindow(c) || (c.start_at && c.start_at > now())) return null;
  if (await activeJob(env, c.id)) return null;
  const L = await limitsFor(env, c), t = ptNow();
  // Spread the day's limit evenly across the sending window, within the sender's warm-up and the tool-wide cap.
  const pace = paceAllowance({ limit: Math.min(c.daily_limit, L.campSent + Math.max(0, Math.min(L.senderLeft, L.toolLeft))), sent: L.campSent, startH: c.window_start, endH: c.window_end, nowH: t.hour + t.minute / 60 });
  const n = allowedNow({ pace, campaignLeft: L.campaignLeft, senderLeft: L.senderLeft, toolLeft: L.toolLeft });
  if (n <= 0) return null;
  const r = await startJob(env, c, 'send', n);
  return r.error && !r.error.startsWith('A run') ? r.error : null;
}
/** Due steps that need a person: calls (any campaign) and every step of a manual campaign go to the Manual queue. */
async function promoteDue(env, c) {
  const steps = await stepsOf(env, c.id); if (!steps.length) return;
  const toQueue = steps.filter(x => x.channel === 'call' || c.mode === 'manual').map(x => x.step);
  if (!toQueue.length) return;
  const calls = steps.filter(x => x.channel === 'call').map(x => x.step).concat(0).join(',');
  await env.DB.prepare(`UPDATE outreach SET prev_status = status, status = 'manual', reason = CASE WHEN step IN (${calls}) THEN 'call' ELSE 'followup' END, next_at = NULL, updated_at = ?
    WHERE campaign_id = ? AND next_at IS NOT NULL AND next_at <= ? AND status IN ('sent','submitted','sent_manual') AND step IN (${toQueue.join(',')}) AND lead_id NOT IN ${STOP}`).bind(now(), c.id, now()).run();
}
export async function runSchedules(env) {
  const r = await env.DB.prepare("SELECT * FROM campaigns WHERE status = 'active'").all();
  for (const c of r.results) { try { await promoteDue(env, c); await tickCampaign(env, c); } catch (e) { console.error('campaign tick', c.id, e); } }
}
/** Rows left "sending" by a job that ended: requeue if the job never started, otherwise send to the manual queue to check. */
export async function settleJobs(env) {
  const ended = "SELECT id FROM searches WHERE kind = 'outreach' AND status IN ('failed','cancelled','done')";
  await env.DB.batch([
    env.DB.prepare(`UPDATE outreach SET status = CASE WHEN step > 1 THEN COALESCE(prev_status, 'sent') ELSE 'queued' END, next_at = CASE WHEN step > 1 THEN ? ELSE next_at END, job_id = NULL WHERE status = 'sending' AND attempt_at IS NULL AND job_id IN (${ended})`).bind(now()),
    env.DB.prepare(`UPDATE outreach SET status = 'manual', reason = 'interrupted', updated_at = ? WHERE status = 'sending' AND job_id IN (${ended})`).bind(now()),
  ]);
}

/* ------------------------------------------------------------------ runner endpoints */
export async function runnerItems(env, s, params) {
  const c = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(params.campaign_id).first();
  const sender = c && c.sender_id ? await env.DB.prepare('SELECT * FROM senders WHERE id = ?').bind(c.sender_id).first() : null;
  if (!c || !sender) throw new HttpError(409, 'The campaign or its sender profile is missing.');
  const where = params.mode === 'test' ? 'o.test_job = ?' : "o.job_id = ? AND o.status = 'sending'";
  const r = await env.DB.prepare(`SELECT o.id AS oid, o.step, l.name, l.city, l.region, l.postal, l.country, l.website, COALESCE(o.form_url, l.form_url) AS form_url, l.category, i.name AS industry
    FROM outreach o JOIN leads l ON l.id = o.lead_id LEFT JOIN industries i ON i.id = l.industry_id WHERE ${where} ORDER BY o.id`).bind(s.id).all();
  return json({
    mode: params.mode, campaign: { id: c.id, subject: c.subject, message: c.message, file_template: c.file_template,
      steps: Object.fromEntries((await stepsOf(env, c.id)).map(x => [x.step, { subject: x.subject || c.subject, message: x.message }])) },
    sender: senderOut(sender), items: r.results.map(x => ({ oid: x.oid, step: params.mode === 'test' ? 1 : x.step || 1, lead: { name: x.name, city: x.city, state: x.region, zip: x.postal, country: x.country, website: x.website, form_url: x.form_url, category: x.category, industry: x.industry } })),
  });
}
const RESULT = { confirmed: 'sent', submitted: 'submitted', manual: 'manual', failed: 'failed', ready: 'ready', skipped: 'skipped' };
export async function runnerResult(env, s, params, b) {
  const oid = +b.oid, t = now();
  const st = RESULT[b.status] || 'failed';
  const reason = b.reason ? str(b.reason, 120) : null, evidence = b.evidence ? str(b.evidence, 300) : null;
  const formUrl = b.form_url && /^https?:\/\//.test(b.form_url) ? str(b.form_url, 500) : null;
  const answers = b.answers ? str(b.answers, 600) : null;
  // The robot saw the form in a real browser: its finding replaces the quicker website check's label.
  const fixLabel = async () => {
    const o = await env.DB.prepare('SELECT lead_id FROM outreach WHERE id = ?').bind(oid).first(); if (!o) return;
    const L = await env.DB.prepare('SELECT form_status, captcha FROM leads WHERE id = ?').bind(o.lead_id).first(); if (!L) return;
    let form = null, cap = L.captcha;
    if (st === 'manual' && b.reason === 'captcha') { form = 1; cap = str(b.captcha, 40) || 'reCAPTCHA'; }
    else if (['sent', 'submitted', 'ready'].includes(st)) { form = 0; cap = null; }
    if (form === null || (form === L.form_status && cap === L.captcha)) return;
    const seq = await reserveSeq(env, 1);
    await env.DB.prepare('UPDATE leads SET form_status = ?, captcha = ?, form_url = COALESCE(?, form_url), seq = ?, updated_at = ? WHERE id = ?').bind(form, cap, formUrl, seq, t, o.lead_id).run();
  };
  if (params.mode === 'test') {
    const testSt = st === 'ready' ? 'ready' : st === 'manual' ? 'manual' : 'failed';
    await env.DB.batch([
      env.DB.prepare('UPDATE outreach SET test_status = ?, test_reason = ?, test_at = ?, form_url = COALESCE(?, form_url), evidence = CASE WHEN status = \'queued\' THEN ? ELSE evidence END, answers = CASE WHEN status = \'queued\' THEN ? ELSE answers END WHERE id = ? AND test_job = ?').bind(testSt, testSt === 'ready' ? null : reason, t, formUrl, evidence, answers, oid, s.id),
      env.DB.prepare('UPDATE searches SET checked = checked + 1, heartbeat_at = ? WHERE id = ?').bind(t, s.id),
    ]);
  } else {
    const o = await env.DB.prepare("SELECT lead_id, step, prev_status FROM outreach WHERE id = ? AND job_id = ? AND status = 'sending'").bind(oid, s.id).first();
    if (o && o.step > 1 && !SENT.includes(st)) {
      // A follow-up that didn't go out: CAPTCHA → Manual queue; otherwise the sequence stops and the lead keeps its earlier result.
      const toManual = st === 'manual';
      await env.DB.batch([
        env.DB.prepare('UPDATE outreach SET status = ?, reason = ?, form_url = COALESCE(?, form_url), next_at = NULL, updated_at = ? WHERE id = ?').bind(toManual ? 'manual' : (o.prev_status || 'sent'), toManual ? reason : null, formUrl, t, oid),
        env.DB.prepare('UPDATE searches SET checked = checked + 1, heartbeat_at = ? WHERE id = ?').bind(t, s.id),
      ]);
      await logEvent(env, { id: oid, lead_id: o.lead_id, campaign_id: params.campaign_id, step: o.step }, toManual ? 'manual' : 'failed', reason);
    } else if (o) {
      const final = st === 'ready' ? 'failed' : st;
      await env.DB.batch([
        env.DB.prepare('UPDATE outreach SET status = ?, reason = ?, evidence = ?, answers = ?, form_url = COALESCE(?, form_url), sent_at = ?, updated_at = ? WHERE id = ?')
          .bind(final, final === 'sent' ? null : reason, evidence, answers, formUrl, SENT.includes(final) ? t : null, t, oid),
        env.DB.prepare('UPDATE searches SET checked = checked + 1, heartbeat_at = ? WHERE id = ?').bind(t, s.id),
      ]);
      if (SENT.includes(final)) { await setLeadStatus(env, [o.lead_id], 2, [0, 1]); await afterSent(env, oid, final, evidence); }
      else { if (final === 'failed') await setLeadStatus(env, [o.lead_id], 0, [1]); await logEvent(env, { id: oid, lead_id: o.lead_id, campaign_id: params.campaign_id, step: 1 }, final, reason); }
    }
  }
  await fixLabel().catch(e => console.error('label fix', e));
  const cur = await env.DB.prepare('SELECT status FROM searches WHERE id = ?').bind(s.id).first();
  return json({ ok: true, stop: cur.status === 'cancelled' });
}
// A filled form that still didn't go through: a sign the message or the engine has a problem (not just a site without a form).
const FILLED_FAIL = ['validation-error', 'fields-still-invalid', 'no-response', 'no-confirmation', 'gave-up-after-retries', 'submit-not-clickable', 'no-submit-button'];
async function autoPause(env, cid, why) {
  await env.DB.batch([
    env.DB.prepare("UPDATE campaigns SET status = 'paused', updated_at = ? WHERE id = ? AND status = 'active'").bind(now(), cid),
    env.DB.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').bind('autopause:' + cid, JSON.stringify({ why, at: now() })),
  ]);
}
/** After a send run: pause the campaign if most filled forms failed to go through, or if two runs in a row failed. */
async function checkRun(env, s, b) {
  let params = {}; try { params = JSON.parse(s.params || '{}'); } catch { /* none */ }
  if (params.mode === 'test' || !s.campaign_id) return;
  const c = await env.DB.prepare('SELECT id, status FROM campaigns WHERE id = ?').bind(s.campaign_id).first();
  if (!c || c.status !== 'active') return;
  const out = b.metrics?.counts?.outcome || {}, reasons = b.metrics?.counts?.reason || {};
  const ok = (out.confirmed || 0) + (out.submitted || 0), bad = FILLED_FAIL.reduce((a, k) => a + (reasons[k] || 0), 0);
  if (ok + bad >= 6 && ok / (ok + bad) < 0.4)
    return autoPause(env, c.id, `in the last run only ${ok} of ${ok + bad} filled forms went through. The forms may be rejecting something in the message or sender profile. Check the failed results, then resume.`);
  if (b.error) {
    const prev = await env.DB.prepare("SELECT status FROM searches WHERE kind = 'outreach' AND campaign_id = ? AND id < ? ORDER BY id DESC LIMIT 1").bind(c.id, s.id).first();
    if (prev && prev.status === 'failed') return autoPause(env, c.id, 'two sending runs in a row stopped early. Check the last error, then resume.');
  }
}
export async function runnerFinishOutreach(env, s, b = {}) {
  await checkRun(env, s, b).catch(e => console.error('auto-pause check', e));
  await env.DB.batch([
    env.DB.prepare("UPDATE outreach SET status = CASE WHEN step > 1 THEN COALESCE(prev_status, 'sent') ELSE 'queued' END, next_at = CASE WHEN step > 1 THEN ? ELSE next_at END, job_id = NULL WHERE job_id = ? AND status = 'sending' AND attempt_at IS NULL").bind(now(), s.id),
    env.DB.prepare("UPDATE outreach SET status = 'manual', reason = 'interrupted', updated_at = ? WHERE job_id = ? AND status = 'sending'").bind(now(), s.id),
  ]);
}
export async function runnerStartItem(env, s, params, b) {
  if (params.mode !== 'test') await env.DB.prepare("UPDATE outreach SET attempt_at = ? WHERE id = ? AND job_id = ? AND status = 'sending'").bind(now(), +b.oid, s.id).run();
  const cur = await env.DB.prepare('SELECT status FROM searches WHERE id = ?').bind(s.id).first();
  return json({ ok: true, stop: cur.status === 'cancelled' });
}
export { LEAD_COLS };


/* ------------------------------------------------------------------ test-run review (accuracy answer key) */
const REVIEWS = ['right', 'wrong_fields', 'not_contact', 'correct_none', 'missed_form', 'captcha_ok', 'captcha_wrong'];
/** Runner: store a test-run screenshot (JPEG) for one form, kept 14 days. */
export async function runnerShot(env, s, params, req, url) {
  const oid = +url.searchParams.get('oid');
  if (params.mode !== 'test' || !oid) throw new HttpError(400, 'Screenshots are for test runs only.');
  const o = await env.DB.prepare('SELECT id FROM outreach WHERE id = ? AND test_job = ?').bind(oid, s.id).first();
  if (!o) throw new HttpError(404, 'Not in this run.');
  const buf = await req.arrayBuffer();
  if (buf.byteLength > 600000) throw new HttpError(413, 'Screenshot too large.');
  await env.KV.put('shot:' + oid, buf, { expirationTtl: 14 * 86400 });
  await env.DB.prepare('UPDATE outreach SET shot_at = ?, review = NULL, review_at = NULL WHERE id = ?').bind(now(), oid).run();
  return json({ ok: true });
}
export async function getShot(env, oid) {
  const b = await env.KV.get('shot:' + oid, { type: 'arrayBuffer' });
  if (!b) throw new HttpError(404, 'Screenshot expired or missing.');
  return new Response(b, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400' } });
}
/** Your verdict on one test result; recomputes the detection and field scores from the last 60 days of reviews. */
export async function reviewItem(env, oid, b) {
  if (!REVIEWS.includes(b.review)) throw new HttpError(400, 'Unknown verdict.');
  await env.DB.prepare('UPDATE outreach SET review = ?, review_at = ? WHERE id = ?').bind(b.review, now(), oid).run();
  const rows = (await env.DB.prepare('SELECT review, COUNT(*) AS n FROM outreach WHERE review IS NOT NULL AND review_at >= ? GROUP BY review').bind(now() - 60 * 864e5).all()).results;
  const n = Object.fromEntries(rows.map(r => [r.review, r.n])), g = k => n[k] || 0;
  const detOk = g('right') + g('wrong_fields') + g('correct_none') + g('captcha_ok'), detAll = detOk + g('not_contact') + g('missed_form') + g('captcha_wrong');
  const fillAll = g('right') + g('wrong_fields');
  const day = new Date().toISOString().slice(0, 10), put = (k, v) => env.DB.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').bind('score:' + k, JSON.stringify(v));
  const ops = [];
  if (detAll) ops.push(put('detection', { pct: Math.round(detOk / detAll * 1000) / 10, n: detAll, at: day }));
  if (fillAll) ops.push(put('fields', { pct: Math.round(g('right') / fillAll * 1000) / 10, n: fillAll, at: day }));
  if (ops.length) await env.DB.batch(ops);
  return json({ ok: true, reviewed: detAll });
}

/* ------------------------------------------------------------------ health alerts */
/** Problems worth your attention, shown in the app: failed runs, stalled campaigns, a full Manual queue. */
export async function healthAlerts(env) {
  const t = now(), out = [];
  const failed = (await env.DB.prepare(`SELECT s.id, s.error, c.name FROM searches s JOIN campaigns c ON c.id = s.campaign_id WHERE s.kind = 'outreach' AND s.status = 'failed' AND s.finished_at >= ? ORDER BY s.id DESC LIMIT 3`).bind(t - 864e5).all()).results;
  for (const f of failed) {
    const why = /stopped responding|did not start|crashed/i.test(f.error || '') ? 'the robot stopped partway. Leads it hadn\'t reached went back to the queue, and any form caught mid-send is in the Manual queue to check.' : String(f.error || 'unknown error').slice(0, 140);
    out.push({ level: 'bad', key: 'job-' + f.id, text: `A sending run for “${f.name}” stopped early: ${why}`, href: '#campaigns' });
  }
  const active = (await env.DB.prepare(`SELECT c.*, (SELECT COUNT(*) FROM outreach o WHERE o.campaign_id = c.id AND o.status = 'queued') AS queued,
      (SELECT MAX(o.sent_at) FROM outreach o WHERE o.campaign_id = c.id) AS last_sent,
      (SELECT MAX(COALESCE(s.finished_at, s.created_at)) FROM searches s WHERE s.kind = 'outreach' AND s.campaign_id = c.id) AS last_job
    FROM campaigns c WHERE c.status = 'active' AND COALESCE(c.mode, 'auto') = 'auto'`).all()).results;
  for (const c of active) {
    if (!c.queued || !inWindow(c) || (c.start_at && c.start_at > t)) continue;
    if (await activeJob(env, c.id)) continue;
    const L = await limitsFor(env, c);
    if (L.campaignLeft <= 0 || L.senderLeft <= 0 || L.toolLeft <= 0) continue;
    const since = Math.max(c.last_sent || 0, c.last_job || 0, c.updated_at || 0);
    if (t - since > 60 * 60000) out.push({ level: 'warn', key: 'stall-' + c.id, text: `“${c.name}” is in its sending hours with ${c.queued} leads waiting, but nothing has gone out for over an hour.`, href: `#campaign/${c.id}` });
  }
  const manual = (await env.DB.prepare("SELECT COUNT(*) AS n FROM outreach o JOIN campaigns c ON c.id = o.campaign_id WHERE o.status = 'manual' AND c.status != 'archived'").first()).n;
  if (manual >= 25) out.push({ level: 'warn', key: 'manual', text: `${manual} forms are waiting in your Manual queue.`, href: '#manual' });
  const paused = (await env.DB.prepare("SELECT id, name, v FROM campaigns c JOIN meta m ON m.k = 'autopause:' || c.id WHERE c.status = 'paused'").all()).results;
  for (const p of paused) { let why = ''; try { why = JSON.parse(p.v).why; } catch { /* plain */ } out.push({ level: 'bad', key: 'autopause-' + p.id, text: `“${p.name}” was paused automatically: ${why}`, href: `#campaign/${p.id}` }); }
  return out;
}

/** Blacklist check result for one sender profile: when listed, pause every active campaign that sends as it. */
export async function blacklistResult(env, b) {
  const id = +b.sender_id; if (!id) throw new HttpError(400, 'sender_id is required.');
  await env.DB.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').bind('blacklist:' + id, JSON.stringify({ listed: !!b.listed, source: String(b.source || '').slice(0, 40), at: now() })).run();
  if (!b.listed) return json({ ok: true, paused: 0 });
  const cs = (await env.DB.prepare("SELECT id FROM campaigns WHERE sender_id = ? AND status = 'active'").bind(id).all()).results;
  for (const c of cs) await autoPause(env, c.id, `its sender profile's email appears on a public spam blacklist (${String(b.source || 'StopForumSpam').slice(0, 40)}). Sending more would likely land in spam. Use another sender profile or check the listing, then resume.`);
  return json({ ok: true, paused: cs.length });
}


