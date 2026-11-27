// Delivery test: real sends to your own Formspree form, then records the false "Sent" score.
// Prints counts only. The form URL and seed inbox come from GitHub secrets and are never printed.
// Env: TEST_FORM_URL, SEED_INBOXES, LH_API, RUNNER_SECRET, SUITE_SUMMARY (JSON line from the form suite), SENDS.
import http from 'node:http';
import { submitForm } from '../runner/forms/filler.mjs';
import { getBrowser, closeBrowser } from '../runner/browser.mjs';

const FORM = process.env.TEST_FORM_URL, SENDS = Math.min(5, +process.env.SENDS || 3);
const inbox = (process.env.SEED_INBOXES || '').split(',').map(s => s.trim()).filter(Boolean)[0];
const API = (process.env.LH_API || 'https://leadshunter.thebatsystems.workers.dev').replace(/\/$/, '');
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const results = [];

if (FORM && inbox && /^https:\/\/formspree\.io\/f\/\w+$/.test(FORM)) {
  // A plain small-business contact page whose form posts to Formspree, the way many real sites use it.
  const page = (n) => `<!doctype html><html><head><title>Test Contracting</title></head><body><h1>Contact Test Contracting</h1>
    <form action="${FORM}" method="POST"><label>Name <input name="name" required></label><label>Email <input type="email" name="email" required></label>
    <label>Phone <input name="phone"></label><label>Message <textarea name="message" required></textarea></label>
    <input type="hidden" name="_subject" value="LeadsHunter delivery test ${stamp}-${n}"><button type="submit">Send</button></form></body></html>`;
  const srv = http.createServer((req, res) => { const n = (req.url.match(/\d+/) || ['1'])[0]; res.writeHead(200, { 'content-type': 'text/html' }); res.end(page(n)); });
  await new Promise(r => srv.listen(8898, r));
  const browser = await getBrowser();
  for (let n = 1; n <= SENDS; n++) {
    const ctx = await browser.newContext(); const p = await ctx.newPage();
    const profile = { firstName: 'LeadsHunter', lastName: 'Delivery Test', email: inbox, phone: '(512) 555-0199', company: 'The Bat Marketing', website: 'thebatmarketing.com',
      city: 'Austin', state: 'TX', stateName: 'Texas', zip: '78701', country: 'United States', address: '100 Congress Ave',
      subject: `LeadsHunter delivery test ${stamp}-${n}`, message: `Delivery test ${stamp}-${n}. If you see this in your inbox, the send arrived. Code LH-${stamp}-${n}.` };
    let r; try { r = await submitForm(p, `http://localhost:8898/f/${n}`, profile, { lead: { name: 'Test Contracting' }, debug: !!process.env.DEBUG }); } catch (e) { r = { status: 'error', reason: e.message.split('\n')[0].slice(0, 80) }; if (process.env.DEBUG) console.log(String(e.stack).split('\n').slice(0, 6).join('\n')); }
    results.push({ n, status: r.status, reason: r.reason || '' });
    console.log(`Formspree send ${n}: ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
    await ctx.close();
  }
  await closeBrowser(); srv.close();
  console.log(`Check the seed inbox for ${results.filter(r => ['confirmed', 'submitted'].includes(r.status)).length} messages with codes LH-${stamp}-1 to LH-${stamp}-${SENDS}.`);
} else console.log('Formspree test skipped: TEST_FORM_URL or SEED_INBOXES not set.');

// Score: false "Sent" from the 34-form suite (every submission there is checked on the server).
const sum = (() => { try { return JSON.parse((process.env.SUITE_SUMMARY || '').replace(/^SUMMARY /, '')); } catch { return null; } })();
if (sum && process.env.RUNNER_SECRET) {
  const pct = sum.said_sent ? (sum.false_sent + sum.sent_when_it_should_not) / sum.said_sent * 100 : 0;
  const r = await fetch(`${API}/api/runner/score`, { method: 'POST', headers: { authorization: `Bearer ${process.env.RUNNER_SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'false_sent', pct, n: sum.said_sent }) });
  console.log(`Suite: ${sum.passed}/${sum.total} passed, ${sum.false_sent} false "Sent", ${sum.sent_when_it_should_not} sent when it should not. Score saved: ${r.ok}`);
}
