// Accuracy check on real leads: the robot visits a sample in test mode (fills, never submits) and compares its verdict
// with the website check's label. Prints totals only (no names, URLs or contact details): the logs are public.
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, SAMPLE (default 60).
import { appendFileSync } from 'node:fs';
import { submitForm } from '../runner/forms/filler.mjs';
import { getBrowser, closeBrowser } from '../runner/browser.mjs';
import { shouldBlock } from '../runner/lib/block.mjs';

const TOKEN = process.env.CLOUDFLARE_API_TOKEN, ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID, N = Math.min(150, +process.env.SAMPLE || 60);
const cf = async (path, body) => { const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!j.success) throw new Error(JSON.stringify(j.errors).slice(0, 200)); return j.result; };
const db = (await cf('/d1/database?name=leadshunter')).find(d => d.name === 'leadshunter');
const q = async (sql) => (await cf(`/d1/database/${db.uuid}/query`, { sql }))[0].results;
const LABEL = ['open', 'captcha', 'none'];
const pick = async (fs, n) => q(`SELECT name, city, region, website, form_url, form_status FROM leads WHERE deleted = 0 AND website IS NOT NULL AND form_status = ${fs} ORDER BY RANDOM() LIMIT ${n}`);
const leads = [...await pick(0, Math.round(N * 0.6)), ...await pick(1, Math.round(N * 0.2)), ...await pick(2, Math.round(N * 0.2))];
const profile = { firstName: 'Test', lastName: 'Visitor', email: 'test@example.com', phone: '(512) 555-0100', company: 'Example Co', website: 'example.com', city: 'Austin', state: 'TX', stateName: 'Texas', zip: '78701', country: 'United States', address: '100 Congress Ave', subject: 'Quick question', message: 'Hello, this is a test message that is never sent.' };

const browser = await getBrowser();
const matrix = {}, times = [], stages = { open: [], settle: [], find: [], fill: [] };
let i = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (i < leads.length) {
    const L = leads[i++], ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    await ctx.route('**/*', r => (shouldBlock(r.request().url(), r.request().resourceType()) ? r.abort() : r.continue()));
    const page = await ctx.newPage(), marks = {}, t0 = Date.now();
    let r;
    try { r = await Promise.race([submitForm(page, L.form_url || L.website, profile, { lead: { name: L.name, city: L.city }, dryRun: true, marks }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 90000))]); }
    catch (e) { r = { status: 'failed', reason: /timeout/i.test(e.message) ? 'site-too-slow' : 'page-error' }; }
    times.push(Date.now() - t0);
    if (marks.dom) stages.open.push(marks.dom - marks.start); if (marks.loaded) stages.settle.push(marks.loaded - marks.dom);
    if (marks.scanned) stages.find.push(marks.scanned - marks.loaded); if (marks.filled) stages.fill.push(marks.filled - marks.scanned);
    const said = LABEL[L.form_status], got = r.status === 'ready' ? 'fillable form' : r.reason === 'captcha' ? 'CAPTCHA' : r.reason === 'no-form' ? 'no form' : r.reason === 'no-solicitation' ? 'asks not to pitch' : `other (${r.reason || r.status})`;
    ((matrix[said] ||= {})[got] = (matrix[said][got] || 0) + 1);
    await ctx.close().catch(() => {});
  }
}));
await closeBrowser();

const pct = (v, p) => { const s = [...v].sort((a, b) => a - b); return s.length ? (s[Math.min(s.length - 1, Math.floor(p * s.length))] / 1000).toFixed(1) : '-'; };
const out = []; const say = (s = '') => { console.log(s); out.push(s); };
say(`## Accuracy check on ${leads.length} real leads (test mode, nothing submitted)`);
say('');
say('| Website check said | Robot found | Count |');
say('| --- | --- | --- |');
for (const [said, row] of Object.entries(matrix)) for (const [got, n] of Object.entries(row).sort((a, b) => b[1] - a[1])) say(`| ${said} | ${got} | ${n} |`);
const agree = (matrix.open?.['fillable form'] || 0) + (matrix.captcha?.CAPTCHA || 0) + (matrix.none?.['no form'] || 0);
say('');
say(`Agreement: ${agree} of ${leads.length} (${Math.round(agree / Math.max(1, leads.length) * 100)}%). "Open form" leads the robot could fill: ${matrix.open?.['fillable form'] || 0} of ${Object.values(matrix.open || {}).reduce((a, b) => a + b, 0)}.`);
say(`Time per site (s): typical ${pct(times, 0.5)}, slowest 5% ${pct(times, 0.95)} · open ${pct(stages.open, 0.5)} · settle ${pct(stages.settle, 0.5)} · find ${pct(stages.find, 0.5)} · fill ${pct(stages.fill, 0.5)}`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join('\n') + '\n');
