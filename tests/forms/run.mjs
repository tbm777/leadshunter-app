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
  firstName: 'Alex', lastName: 'Morgan', email: 'alex@brightline-studio.com', phone: '+1 512 555 0142',
  company: 'Brightline Studio', website: 'brightline-studio.com', city: 'Austin', state: 'TX', stateName: 'Texas', zip: '78701', country: 'United States',
  address: '100 Congress Ave', subject: 'Quick question about your website',
  message: 'Hi there, I came across your business on Google Maps and loved your reviews. We help local businesses get more calls from their website. Would you be open to a quick 10-minute chat this week?',
};

const { results, close } = await startServer(PORT);
const browser = await pw.chromium.launch();
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
    try { out = await submitForm(page, `${BASE}/f/${fx.id}`, PROFILE, { debug: debug && only.length > 0 }); }
    catch (e) { out = { status: 'error', reason: e.message.split('\n')[0], log: [] }; }
    await ctx.close();
    const r = results[fx.id] || { posts: 0, valid: 0, errors: [], trap: false, wrongForm: 0 };
    const expect = fx.expect || 'confirmed';
    const pass = expect === 'manual' ? out.status === 'manual' && r.posts === 0 : out.status === 'confirmed' && r.valid >= 1 && !r.trap && !r.wrongForm && r.valid === 1;
    rows.push({ fx, out, r, pass, ms: Date.now() - s });
  }
}));
await browser.close(); close();

rows.sort((a, b) => FIXTURES.indexOf(a.fx) - FIXTURES.indexOf(b.fx));
for (const { fx, out, r, pass, ms } of rows) {
  console.log(`${pass ? '✔' : '✘'} ${fx.id.padEnd(26)} ${fx.industry.padEnd(18)} ${String(out.status).padEnd(10)} ${(out.reason || out.evidence || '').slice(0, 60).padEnd(60)} posts=${r.posts} valid=${r.valid}${r.trap ? ' TRAP' : ''}${r.wrongForm ? ' WRONG-FORM' : ''} ${(ms / 1000).toFixed(1)}s`);
  if (!pass) { for (const e of r.errors) console.log('     server:', e); if (!debug) for (const l of out.log || []) console.log('     ·', l); }
}
const passed = rows.filter(r => r.pass).length;
console.log(`\n${passed}/${rows.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(passed === rows.length ? 0 : 1);
