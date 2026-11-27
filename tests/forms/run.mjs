// Runs the form engine against every fixture. A pass needs a valid submission on the server AND a detected confirmation.
// Usage: node tests/forms/run.mjs [fixture-id ...] [--debug]
import { createRequire } from 'node:module';
import { startServer } from './server.mjs';
import { FIXTURES } from './fixtures.mjs';
import { submitForm } from '../../runner/forms/filler.mjs';

const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = createRequire('/opt/node22/lib/node_modules/')('playwright'); }

const args = process.argv.slice(2), debug = args.includes('--debug'), only = args.filter(a => !a.startsWith('--'));
const PORT = 8899, BASE = `http://localhost:${PORT}`;
export const PROFILE = {
  firstName: 'Dustin', lastName: 'Morgan', email: 'hello@thebatmarketing.com', phone: '+1 512 555 0142',
  company: 'The Bat Marketing', website: 'thebatmarketing.com', city: 'Austin', state: 'TX', stateName: 'Texas', zip: '78701', country: 'United States',
  address: '100 Congress Ave',
  subject: 'Quick question about missed calls at [Company Name]',
  message: "Hi [Company Name] team,\n\nWhen a homeowner calls you and nobody picks up, most of them don't leave a voicemail. They call the next contractor on the list. That's a job lost before anyone knew it existed.\n\nWe set up simple systems for contractors that fix this. If you miss a call, the caller gets a text right away. Questions from your website land on your phone as texts. After each job, customers get a polite request for a Google review.\n\nWe build it and connect everything for you. Your team runs it from a phone. No jargon, no training course, and no long-term contract.\n\nWould a 15-minute call next week make sense? If it isn't a fit, I'll tell you.\n\nBest,\nDustin\nThe Bat Marketing",
};

const { results, close } = await startServer(PORT);
const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const list = FIXTURES.filter(f => !only.length || only.includes(f.id));
const rows = [];
const t0 = Date.now();
await Promise.all(Array.from({ length: 4 }, async () => {
  while (list.length) {
    const fx = list.shift();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const s = Date.now();
    let out;
    const lead = { name: `${fx.industry} Pros - Best ${fx.industry} in Austin TX | Free Quotes`, city: 'Austin' };
    try { out = await submitForm(page, `${BASE}/f/${fx.id}`, PROFILE, { lead, debug: debug && only.length > 0 }); }
    catch (e) { out = { status: 'error', reason: e.message.split('\n')[0], log: [] }; }
    await ctx.close();
    const r = results[fx.id] || { posts: 0, valid: 0, errors: [], trap: false, wrongForm: 0 };
    const expect = fx.expect || 'confirmed';
    const sent = JSON.stringify(r.data || {});
    const tagsLeft = /\[Company Name\]|\{\{?\s*company/i.test(sent);
    const filesOk = !(fx.files || []).length || (r.files || []).some(f => /^the-bat-marketing-for-[a-z0-9-]+\.(pdf|png|jpg)/.test(f));
    if (tagsLeft) out.reason = 'merge tag left unfilled';
    if (!filesOk) out.reason = 'upload missing or not branded';
    const pass = expect === 'noform' ? out.status === 'failed' && out.reason === 'no-form' && r.posts === 0 : expect === 'manual' ? out.status === 'manual' && r.posts === 0 : out.status === 'confirmed' && r.valid === 1 && !r.trap && !r.wrongForm && !tagsLeft && filesOk;
    rows.push({ fx, out, r, pass, ms: Date.now() - s });
  }
}));
await browser.close(); close();

rows.sort((a, b) => FIXTURES.indexOf(a.fx) - FIXTURES.indexOf(b.fx));
for (const { fx, out, r, pass, ms } of rows) {
  if (r.files?.length) out.evidence = (out.evidence || '') + ' · file: ' + r.files.join(', ');
  console.log(`${pass ? '✔' : '✘'} ${fx.id.padEnd(26)} ${fx.industry.padEnd(18)} ${String(out.status).padEnd(10)} ${(out.reason || out.evidence || '').slice(0, 90).padEnd(90)} posts=${r.posts} valid=${r.valid}${r.trap ? ' TRAP' : ''}${r.wrongForm ? ' WRONG-FORM' : ''} ${(ms / 1000).toFixed(1)}s`);
  if (!pass) { for (const e of r.errors) console.log('     server:', e); if (!debug) for (const l of out.log || []) console.log('     ·', l); }
}
const passed = rows.filter(r => r.pass).length;
console.log(`\n${passed}/${rows.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(passed === rows.length ? 0 : 1);
