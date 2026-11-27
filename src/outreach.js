// Outreach: sender profiles, campaigns, the send queue, the manual queue and the runner endpoints for form sending.
import { isSocialHost } from '../public/shared/normalize.js';
import { json, HttpError, reserveSeq, dispatch, ptMidnight, chunk, inList, LEAD_COLS } from './worker.js';

const now = () => Date.now();
const BATCH = 40;                        // forms per runner job
const TEST_MAX = 25;
const SENT = ['sent', 'submitted', 'sent_manual'];
const STATUSES = ['queued', 'sending', 'sent', 'submitted', 'manual', 'sent_manual', 'failed', 'skipped'];
const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);

/* ------------------------------------------------------------------ overview */
export async function outreachOverview(env) {
  const today = ptMidnight();
  const [snd, cmp, stats, todayQ, manual, jobs] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM senders WHERE archived = 0 ORDER BY id'),
    env.DB.prepare("SELECT * FROM campaigns WHERE status != 'archived' ORDER BY id DESC"),
    env.DB.prepare('SELECT campaign_id, status, COUNT(*) AS n FROM outreach GROUP BY campaign_id, status'),
    env.DB.prepare(`SELECT campaign_id, COUNT(*) AS n FROM outreach WHERE sent_at >= ? AND status IN ('sent','submitted','sent_manual') GROUP BY campaign_id`).bind(today),
    env.DB.prepare("SELECT COUNT(*) AS n FROM outreach o JOIN campaigns c ON c.id = o.campaign_id WHERE o.status = 'manual' AND c.status != 'archived'"),
    env.DB.prepare("SELECT id, campaign_id, status, params, to_check, checked, created_at, started_at, finished_at, error, run_url FROM searches WHERE kind = 'outreach' AND id IN (SELECT MAX(id) FROM searches WHERE kind = 'outreach' GROUP BY campaign_id)"),
  ]);
  const by = {};
  for (const r of stats.results) (by[r.campaign_id] ||= {})[r.status] = r.n;
  const td = Object.fromEntries(todayQ.results.map(r => [r.campaign_id, r.n]));
  const jb = Object.fromEntries(jobs.results.map(j => [j.campaign_id, jobOut(j)]));
  return json({
    senders: snd.results.map(senderOut),
    campaigns: cmp.results.map(c => campaignOut(c, by[c.id] || {}, td[c.id] || 0, jb[c.id] || null)),
    manual: manual.results[0].n,
  });
}
function jobOut(j) {
  let mode = 'send'; try { mode = JSON.parse(j.params).mode || 'send'; } catch { /* default */ }
  return { id: j.id, status: j.status, mode, total: j.to_check, done: j.checked, created_at: j.created_at, started_at: j.started_at, finished_at: j.finished_at, error: j.error, run_url: j.run_url };
}
const senderOut = s => ({ id: s.id, label: s.label, first_name: s.first_name, last_name: s.last_name, email: s.email, phone: s.phone, company: s.company, website: s.website, address: s.address, city: s.city, state: s.state, zip: s.zip, country: s.country });
function campaignOut(c, counts = {}, today = 0, job = null) {
  const n = k => counts[k] || 0;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    id: c.id, name: c.name, sender_id: c.sender_id, subject: c.subject, message: c.message, file_template: c.file_template,
    daily_limit: c.daily_limit, window_start: c.window_start, window_end: c.window_end, weekdays: c.weekdays, status: c.status, start_at: c.start_at || null, msg_version: c.msg_version || 1,
    created_at: c.created_at, updated_at: c.updated_at, today, job,
    counts: { total, queued: n('queued'), sending: n('sending'), sent: n('sent'), submitted: n('submitted'), sent_manual: n('sent_manual'), manual: n('manual'), failed: n('failed'), skipped: n('skipped') },
  };
}
async function campaignById(env, id) {
  const today = ptMidnight();
  const [c, st, td, jb] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id),
    env.DB.prepare('SELECT status, COUNT(*) AS n FROM outreach WHERE campaign_id = ? GROUP BY status').bind(id),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM outreach WHERE campaign_id = ? AND sent_at >= ? AND status IN ('sent','submitted','sent_manual')`).bind(id, today),
    env.DB.prepare("SELECT id, campaign_id, status, params, to_check, checked, created_at, started_at, finished_at, error, run_url FROM searches WHERE kind = 'outreach' AND campaign_id = ? ORDER BY id DESC LIMIT 1").bind(id),
  ]);
  const row = c.results[0];
  if (!row) throw new HttpError(404, 'Campaign not found.');
  return campaignOut(row, Object.fromEntries(st.results.map(r => [r.status, r.n])), td.results[0].n, jb.results[0] ? jobOut(jb.results[0]) : null);
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
  const c = await env.DB.prepare('SELECT id, status FROM campaigns WHERE id = ?').bind(id).first();
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
    else if (!b.includeContacted && (l.status === 2 || contacted.has(l.id))) out.skipped.contacted++;
    else if (!l.website) out.skipped.noWebsite++;
    else if (l.site_status === 7 || (() => { try { return isSocialHost(new URL(l.website).hostname); } catch { return false; } })()) out.skipped.profile++;
    else if (l.form_status === 2) out.skipped.noForm++;
    else if (l.form_status === 1) out.manual.push(l);   // CAPTCHA known from the website check: straight to the manual queue
    else out.add.push(l);
  }
  const summary = { add: out.add.length, manual: out.manual.length, skipped: out.skipped };
  if (b.dry) return json(summary);
  const t = now();
  const stmts = [
    ...out.add.map(l => env.DB.prepare("INSERT OR IGNORE INTO outreach (campaign_id, lead_id, status, form_url, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?, ?)").bind(id, l.id, l.form_url, t, t)),
    ...out.manual.map(l => env.DB.prepare("INSERT OR IGNORE INTO outreach (campaign_id, lead_id, status, reason, form_url, created_at, updated_at) VALUES (?, ?, 'manual', 'captcha', ?, ?, ?)").bind(id, l.id, l.form_url, t, t)),
  ];
  for (const part of chunk(stmts, 400)) await env.DB.batch(part);
  await setLeadStatus(env, [...out.add, ...out.manual].map(l => l.id), 1, [0]);
  if (c.status === 'active') ctxTick(env, id);
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
    await setLeadStatus(env, [o.lead_id], 2);
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
  if (!cid) where.push("c.status != 'archived'");
  // Campaign lists keep the order leads were added, so rows don't jump while a run updates them.
  const order = q.get('order') === 'sent' ? 'o.sent_at DESC, o.id DESC' : q.get('order') === 'recent' ? 'o.updated_at DESC, o.id DESC' : 'o.id';
  const limit = Math.min(500, +q.get('limit') || 200), offset = Math.max(0, +q.get('offset') || 0);
  const sql = `SELECT o.id, o.campaign_id, o.lead_id, o.status, o.reason, o.evidence, o.form_url, o.test_status, o.test_reason, o.test_at, o.sent_at, o.updated_at,
      l.name, l.website, l.city, l.region, l.phone, l.category, l.industry_id, c.name AS campaign
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
  if (b.action === 'sent') {
    if (SENT.includes(o.status)) return json({ ok: true });
    await env.DB.prepare("UPDATE outreach SET status = 'sent_manual', reason = NULL, sent_at = ?, updated_at = ? WHERE id = ?").bind(t, t, oid).run();
    await setLeadStatus(env, [o.lead_id], 2);
  } else if (b.action === 'skip') {
    if (['sending', ...SENT].includes(o.status)) throw new HttpError(409, 'This one is already sent or sending.');
    await env.DB.prepare("UPDATE outreach SET status = 'skipped', reason = COALESCE(reason, 'skipped by you'), updated_at = ? WHERE id = ?").bind(t, oid).run();
    await setLeadStatus(env, [o.lead_id], 0, [1]);
  } else if (b.action === 'retry') {
    if (!['manual', 'failed', 'skipped'].includes(o.status)) throw new HttpError(409, 'Only failed, skipped or manual items can be retried.');
    await env.DB.prepare("UPDATE outreach SET status = 'queued', reason = NULL, evidence = NULL, updated_at = ? WHERE id = ?").bind(t, oid).run();
    await setLeadStatus(env, [o.lead_id], 1, [0]);
    ctxTick(env, o.campaign_id);
  } else if (b.action === 'dnc') {
    if (['sending'].includes(o.status)) throw new HttpError(409, 'This one is sending right now.');
    if (!SENT.includes(o.status)) await env.DB.prepare("UPDATE outreach SET status = 'skipped', reason = 'do not contact', updated_at = ? WHERE id = ?").bind(t, oid).run();
    await setLeadStatus(env, [o.lead_id], 3);
  } else throw new HttpError(400, 'Unknown action.');
  return json({ ok: true });
}

/** A lead marked contacted (some other way) or do-not-contact by hand: don't send it anything still waiting. */
export async function skipUnsent(env, leadIds, status) {
  if (![2, 3].includes(status) || !leadIds.length) return;
  const reason = status === 3 ? 'do not contact' : 'already contacted';
  for (const part of chunk(leadIds, 90)) await env.DB.prepare(`UPDATE outreach SET status = 'skipped', reason = ?, updated_at = ? WHERE lead_id IN (${inList(part.length)}) AND status IN ('queued','manual','failed')`).bind(reason, now(), ...part).run();
}
export async function leadOutreach(env, id) {
  const r = await env.DB.prepare(`SELECT o.id, o.campaign_id, c.name AS campaign, o.status, o.reason, o.evidence, o.form_url, o.sent_at, o.updated_at, o.created_at, o.test_status, o.test_reason, o.test_at, o.answers,
      COALESCE(m.subject, c.subject) AS subject, COALESCE(m.message, c.message) AS message, o.msg_version, c.sender_id
    FROM outreach o JOIN campaigns c ON c.id = o.campaign_id LEFT JOIN campaign_messages m ON m.campaign_id = o.campaign_id AND m.version = o.msg_version
    WHERE o.lead_id = ? ORDER BY o.id DESC`).bind(id).all();
  return json({ items: r.results });
}

/* ------------------------------------------------------------------ runs */
async function activeJob(env, cid) {
  return env.DB.prepare("SELECT id, status FROM searches WHERE kind = 'outreach' AND campaign_id = ? AND status IN ('queued','running') ORDER BY id DESC LIMIT 1").bind(cid).first();
}
async function sentToday(env, cid) {
  return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM outreach WHERE campaign_id = ? AND ((sent_at >= ? AND status IN ('sent','submitted','sent_manual')) OR status = 'sending')`).bind(cid, ptMidnight()).first()).n;
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
    n = (await env.DB.prepare("UPDATE outreach SET status = 'sending', job_id = ?, msg_version = ?, attempt_at = NULL, attempts = attempts + 1, updated_at = ? WHERE id IN (SELECT id FROM outreach WHERE campaign_id = ? AND status = 'queued' ORDER BY id LIMIT ?)").bind(job.id, c.msg_version || 1, t, c.id, count).run()).meta.changes;
  }
  if (!n) { await env.DB.prepare('DELETE FROM searches WHERE id = ?').bind(job.id).run(); return { error: null, empty: true }; }
  await env.DB.prepare('UPDATE searches SET to_check = ? WHERE id = ?').bind(n, job.id).run();
  const err = await dispatch(env, job.id);
  if (err) {
    await env.DB.batch([
      env.DB.prepare("UPDATE searches SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").bind(err, now(), job.id),
      env.DB.prepare("UPDATE outreach SET status = 'queued', job_id = NULL WHERE job_id = ? AND status = 'sending'").bind(job.id),
    ]);
    return { error: err };
  }
  return { error: null, id: job.id, n };
}
export async function runCampaign(env, id, b) {
  const c = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first();
  if (!c || c.status === 'archived') throw new HttpError(404, 'Campaign not found.');
  checkReady(c);
  const mode = b.mode === 'test' ? 'test' : 'send';
  let count = Math.max(1, Math.floor(+b.count || 0));
  if (mode === 'test') count = Math.min(TEST_MAX, count || 10);
  else {
    const left = c.daily_limit - await sentToday(env, id);
    if (left <= 0) throw new HttpError(409, `Today's limit of ${c.daily_limit} is reached. Raise the daily limit in Settings to send more today.`);
    count = Math.min(count || BATCH, left, BATCH * 5);
  }
  const r = await startJob(env, c, mode, count);
  if (r.empty) throw new HttpError(409, 'Nothing queued. Add leads to this campaign first.');
  if (r.error) throw new HttpError(r.error.startsWith('A run') ? 409 : 502, r.error);
  return getCampaign(env, id);
}

/** Scheduler: start the next batch for an active campaign if it's inside its sending window and under today's limit. */
function ptNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { hour: +p.hour, day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
export function inWindow(c) { const { hour, day } = ptNow(); return c.weekdays.includes(String(day)) && hour >= c.window_start && hour < c.window_end; }
async function tickCampaign(env, c) {
  if (c.status !== 'active' || !inWindow(c) || (c.start_at && c.start_at > now())) return null;
  const left = c.daily_limit - await sentToday(env, c.id);
  if (left <= 0) return null;
  const r = await startJob(env, c, 'send', Math.min(BATCH, left));
  return r.error && !r.error.startsWith('A run') ? r.error : null;
}
export async function runSchedules(env) {
  const r = await env.DB.prepare("SELECT * FROM campaigns WHERE status = 'active'").all();
  for (const c of r.results) { try { await tickCampaign(env, c); } catch (e) { console.error('campaign tick', c.id, e); } }
}
/** Rows left "sending" by a job that ended: requeue if the job never started, otherwise send to the manual queue to check. */
export async function settleJobs(env) {
  const ended = "SELECT id FROM searches WHERE kind = 'outreach' AND status IN ('failed','cancelled','done')";
  await env.DB.batch([
    env.DB.prepare(`UPDATE outreach SET status = 'queued', job_id = NULL WHERE status = 'sending' AND attempt_at IS NULL AND job_id IN (${ended})`),
    env.DB.prepare(`UPDATE outreach SET status = 'manual', reason = 'interrupted', updated_at = ? WHERE status = 'sending' AND job_id IN (${ended})`).bind(now()),
  ]);
}

/* ------------------------------------------------------------------ runner endpoints */
export async function runnerItems(env, s, params) {
  const c = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(params.campaign_id).first();
  const sender = c && c.sender_id ? await env.DB.prepare('SELECT * FROM senders WHERE id = ?').bind(c.sender_id).first() : null;
  if (!c || !sender) throw new HttpError(409, 'The campaign or its sender profile is missing.');
  const where = params.mode === 'test' ? 'o.test_job = ?' : "o.job_id = ? AND o.status = 'sending'";
  const r = await env.DB.prepare(`SELECT o.id AS oid, l.name, l.city, l.region, l.website, COALESCE(o.form_url, l.form_url) AS form_url, l.category, i.name AS industry
    FROM outreach o JOIN leads l ON l.id = o.lead_id LEFT JOIN industries i ON i.id = l.industry_id WHERE ${where} ORDER BY o.id`).bind(s.id).all();
  return json({
    mode: params.mode, campaign: { id: c.id, subject: c.subject, message: c.message, file_template: c.file_template },
    sender: senderOut(sender), items: r.results.map(x => ({ oid: x.oid, lead: { name: x.name, city: x.city, state: x.region, website: x.website, form_url: x.form_url, category: x.category, industry: x.industry } })),
  });
}
const RESULT = { confirmed: 'sent', submitted: 'submitted', manual: 'manual', failed: 'failed', ready: 'ready' };
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
    const o = await env.DB.prepare("SELECT lead_id FROM outreach WHERE id = ? AND job_id = ? AND status = 'sending'").bind(oid, s.id).first();
    if (o) {
      const final = st === 'ready' ? 'failed' : st;
      await env.DB.batch([
        env.DB.prepare('UPDATE outreach SET status = ?, reason = ?, evidence = ?, answers = ?, form_url = COALESCE(?, form_url), sent_at = ?, updated_at = ? WHERE id = ?')
          .bind(final, final === 'sent' ? null : reason, evidence, answers, formUrl, SENT.includes(final) ? t : null, t, oid),
        env.DB.prepare('UPDATE searches SET checked = checked + 1, heartbeat_at = ? WHERE id = ?').bind(t, s.id),
      ]);
      if (SENT.includes(final)) await setLeadStatus(env, [o.lead_id], 2);
      else if (final === 'failed') await setLeadStatus(env, [o.lead_id], 0, [1]);
    }
  }
  await fixLabel().catch(e => console.error('label fix', e));
  const cur = await env.DB.prepare('SELECT status FROM searches WHERE id = ?').bind(s.id).first();
  return json({ ok: true, stop: cur.status === 'cancelled' });
}
export async function runnerFinishOutreach(env, s) {
  await env.DB.batch([
    env.DB.prepare("UPDATE outreach SET status = 'queued', job_id = NULL WHERE job_id = ? AND status = 'sending' AND attempt_at IS NULL").bind(s.id),
    env.DB.prepare("UPDATE outreach SET status = 'manual', reason = 'interrupted', updated_at = ? WHERE job_id = ? AND status = 'sending'").bind(now(), s.id),
  ]);
}
export async function runnerStartItem(env, s, params, b) {
  if (params.mode !== 'test') await env.DB.prepare("UPDATE outreach SET attempt_at = ? WHERE id = ? AND job_id = ? AND status = 'sending'").bind(now(), +b.oid, s.id).run();
  const cur = await env.DB.prepare('SELECT status FROM searches WHERE id = ?').bind(s.id).first();
  return json({ ok: true, stop: cur.status === 'cancelled' });
}
export { LEAD_COLS };
