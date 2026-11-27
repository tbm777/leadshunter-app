// Outreach job: fill and send (or test) the contact form of every lead in the batch.
// Never logs lead data: the repository and its logs are public.
import { getBrowser, closeBrowser } from './browser.mjs';
import { submitForm } from './forms/filler.mjs';
import { engineProfile, localizeProfile } from '../public/shared/fallbacks.js';
import { isSocialHost } from '../public/shared/normalize.js';
import { Metrics } from './lib/metrics.mjs';
import { shouldBlock } from './lib/block.mjs';

const CONCURRENCY = +process.env.OUTREACH_CONCURRENCY || 6;   // GitHub's runners have 4 cores; forms spend most of their time waiting on websites
const ITEM_TIMEOUT = 120000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const CONTACT_RE = /contact|get[\s-]?in[\s-]?touch|quote|estimate|appointment|book|request|reach[\s-]?us|consult|schedule/i;

function withTimeout(p, ms) { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); })]).finally(() => clearTimeout(t)); }
const norm = u => { try { const x = new URL(u); x.hash = ''; return x.href.replace(/\/$/, ''); } catch { return null; } };

function profileFrom(sender, campaign) {
  // Empty profile fields get the same fallbacks the app shows in the sender profile form.
  return { ...engineProfile(sender), subject: campaign.subject, message: campaign.message, fileTemplate: campaign.file_template };
}

/** A small JPEG of the visible page, scrolled to the form the robot filled. */
async function snapshot(page) {
  try {
    await page.evaluate(() => { const el = document.querySelector('[data-lh]'); if (el) { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -100); } });
    return await page.screenshot({ type: 'jpeg', quality: 50, timeout: 8000 });
  } catch { return null; }
}

/** Links on the page that look like a contact or quote page, same site only. */
async function contactPages(page, base) {
  const host = new URL(base).hostname.replace(/^www\./, '');
  const links = await page.$$eval('a[href]', as => as.map(a => ({ href: a.href, text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 60) }))).catch(() => []);
  const out = [];
  for (const l of links) {
    let u; try { u = new URL(l.href); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, '') !== host) continue;
    if (!CONTACT_RE.test(l.text) && !CONTACT_RE.test(u.pathname)) continue;
    const n = norm(u.href); if (n && !out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => (/contact/i.test(b) ? 1 : 0) - (/contact/i.test(a) ? 1 : 0)).slice(0, 3);
}

async function attempt(ctx, item, profile, dryRun, stat = {}) {
  const lead = item.lead;
  const tried = new Set();
  // Directory and social profile pages (Houzz, Yelp…) only have the platform's own forms, like signups: never fill those.
  const candidates = [lead.form_url, lead.website].map(norm).filter(u => u && !isSocialHost(new URL(u).hostname));
  if (!candidates.length) return { status: 'failed', reason: 'directory-page' };
  let last = { status: 'failed', reason: 'no-form' };
  const tryUrl = async (url) => {
    if (tried.has(url)) return null;
    tried.add(url);
    const page = await ctx.newPage();
    stat.pages = (stat.pages || 0) + 1;
    const marks = {};
    try {
      const r = await submitForm(page, url, profile, { lead, dryRun, marks });
      marks.end = Date.now(); stat.marks = marks;
      r.form_url = page.url();
      const noForm = r.status === 'failed' && r.reason === 'no-form';
      // Test runs: keep a picture of what the robot saw, for your review (the filled form, or the first page when none was found).
      if (dryRun && (!noForm || !stat.shot)) stat.shot = await snapshot(page);
      if (noForm) { last = r; return { r, links: await contactPages(page, url) }; }
      return { r, done: true };
    } catch (e) {
      last = e.message === 'unsupported-file-type' ? { status: 'manual', reason: 'file-type' } : { status: 'failed', reason: /timeout|Timeout/.test(e.message) ? 'site-too-slow' : /net::|ERR_/.test(e.message) ? 'site-unreachable' : 'page-error' };
      return { r: last };
    } finally { await page.close().catch(() => {}); }
  };
  const queue = [...candidates];
  while (queue.length && tried.size < 5) {
    const res = await tryUrl(queue.shift());
    if (!res) continue;
    if (res.done) return res.r;
    for (const l of res.links || []) if (!tried.has(l)) queue.push(l);
  }
  return last;
}

/** One form's timings and outcome, aggregated only. */
function record(M, r, stat, totalMs) {
  M.time('total', totalMs);
  const k = stat.marks || {};
  if (k.dom) M.time('open', k.dom - k.start);
  if (k.loaded) M.time('settle', k.loaded - k.dom);
  if (k.scanned) M.time('find', k.scanned - k.loaded);
  if (k.filled) M.time('fill', k.filled - k.scanned);
  if (k.filled && k.end) M.time('submit', k.end - k.filled);
  M.count('outcome', r.status);
  if (r.reason) M.count('reason', r.reason);
  M.count('pages', String(Math.min(stat.pages || 0, 5)));
  const tool = k.tool || 'unknown';
  M.group('tool', tool, 'n');
  M.group('tool', tool, r.status);
}

export async function runOutreach({ api, JOB, log, isCancelled }) {
  const data = await api('GET', `/api/runner/jobs/${JOB}/outreach`);
  const dryRun = data.mode === 'test';
  const profile = profileFrom(data.sender, data.campaign);
  const items = [...data.items];
  const M = new Metrics('outreach');
  log(`${dryRun ? 'Testing' : 'Sending'} ${items.length} form${items.length === 1 ? '' : 's'}.`);
  if (!items.length) return { requeue: [] };
  const browser = await getBrowser();
  const tally = {};
  const unattempted = new Set(items.map(i => i.oid));
  let stop = false, chain = Promise.resolve();
  const report = (oid, r) => {
    chain = chain.then(async () => {
      const res = await api('POST', `/api/runner/jobs/${JOB}/outreach-result`, { oid, status: r.status, reason: r.reason || null, evidence: r.evidence || null, form_url: r.form_url || null, answers: r.answers || null, captcha: r.captcha || null });
      if (res.stop) stop = true;
    }).catch(e => log('Could not save a result:', e.message));
    return chain;
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (items.length && !stop && !isCancelled()) {
      const item = items.shift();
      // Record the start first: if the run dies mid-send, this form is flagged for a human check instead of being sent twice.
      const st = await api('POST', `/api/runner/jobs/${JOB}/outreach-start`, { oid: item.oid }).catch(() => null);
      if (!st) { items.unshift(item); stop = true; break; }
      if (st.stop) { items.unshift(item); stop = true; break; }
      unattempted.delete(item.oid);
      const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: 'en-US' });
      await ctx.route('**/*', route => (shouldBlock(route.request().url(), route.request().resourceType()) ? route.abort() : route.continue()));
      let r; const stat = {}, t0 = Date.now();
      // Each lead gets the text for the step it's on (follow-ups have their own message).
      const stepText = (data.campaign.steps || {})[item.step];
      // No address in the profile: use this business's own city, state and ZIP.
      const local = localizeProfile(profile, data.sender, item.lead);
      const prof = stepText && item.step > 1 ? { ...local, subject: stepText.subject || local.subject, message: stepText.message || local.message } : local;
      try { r = await withTimeout(attempt(ctx, item, prof, dryRun, stat), ITEM_TIMEOUT); }
      catch { r = { status: 'failed', reason: 'site-too-slow' }; }
      record(M, r, stat, Date.now() - t0);
      if (dryRun && stat.shot) chain = chain.then(() => api('PUT', `/api/runner/jobs/${JOB}/shot?oid=${item.oid}`, stat.shot, { raw: true, headers: { 'content-type': 'image/jpeg' } })).catch(e => log('Could not save a screenshot:', e.message));
      await ctx.close().catch(() => {});
      tally[r.status] = (tally[r.status] || 0) + 1;
      await report(item.oid, r);
    }
  }));
  await chain;
  await closeBrowser();
  log('Done:', Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing');
  const metrics = M.toJSON({ mode: data.mode, items: data.items.length, concurrency: CONCURRENCY });
  log('Timing (s):', Object.entries(metrics.stages).map(([k, v]) => `${k} p50 ${(v.p50 / 1000).toFixed(1)} p95 ${(v.p95 / 1000).toFixed(1)}`).join(' · '));
  return { requeue: [...unattempted], metrics };
}
