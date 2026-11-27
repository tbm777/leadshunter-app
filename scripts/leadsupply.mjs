// Lead supply test: real Google Maps searches and website checks at volume, the same way the runner does them.
// Prints totals only (no business names, addresses, phones or websites): GitHub logs on a public repo are public.
// Env: GMAPS_BIN, TERMS (comma separated), CITIES (number of cities, max 10), CHECKS (websites to check), MAP_CONCURRENCY.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSite, FORM, SITE } from '../runner/check.mjs';
import { browserFormCheck, closeBrowser } from '../runner/browser.mjs';

const GMAPS = process.env.GMAPS_BIN || './gmaps';
const TERMS = (process.env.TERMS || 'plumber,roofing contractor,hvac contractor,electrician,landscaper').split(',').map(s => s.trim()).filter(Boolean);
const CITIES = [[30.2672, -97.7431], [33.4484, -112.074], [39.7392, -104.9903], [33.749, -84.388], [27.9506, -82.4572], [35.2271, -80.8431], [36.1627, -86.7816], [32.7767, -96.797], [32.7157, -117.1611], [39.9612, -82.9988]]
  .slice(0, Math.min(10, +process.env.CITIES || 6));
const CHECKS = Math.min(600, +process.env.CHECKS || 300), MAPC = +process.env.MAP_CONCURRENCY || 4;
const out = []; const say = (s = '') => { console.log(s); out.push(s); };
const q = (v, p) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };

function search([lat, lon], term, dir) {
  return new Promise(async (resolve) => {
    const id = Math.random().toString(36).slice(2), qf = join(dir, id + '.txt'), of = join(dir, id + '.jsonl');
    await writeFile(qf, term + '\n');
    const t0 = Date.now();
    const child = spawn(GMAPS, ['-fast-mode', '-geo', `${lat},${lon}`, '-zoom', '13', '-radius', '12000', '-depth', '5', '-input', qf, '-results', of, '-json', '-c', '1', '-exit-on-inactivity', '1m'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; child.stderr.on('data', d => { err = (err + d).slice(-4000); });
    const killer = setTimeout(() => child.kill('SIGKILL'), 150000);
    child.on('close', async () => {
      clearTimeout(killer);
      const places = [];
      try { for (const line of (await readFile(of, 'utf8')).split('\n')) { if (!line.trim()) continue; let v; try { v = JSON.parse(line); } catch { continue; } for (const o of (Array.isArray(v) ? v : [v])) if (o && (o.place_id || o.data_id || o.cid)) places.push({ id: o.place_id || o.data_id || o.cid, site: o.web_site || o.website || null }); } } catch { /* none */ }
      rm(qf, { force: true }); rm(of, { force: true });
      const blocked = !places.length && /(429|unusual traffic|google\.com\/sorry|recaptcha)/i.test(err);
      resolve({ places, blocked, ms: Date.now() - t0 });
    });
  });
}

const dir = await mkdtemp(join(tmpdir(), 'ls-'));
const jobs = CITIES.flatMap(c => TERMS.map(t => [c, t]));
const leads = new Map(), times = [], counts = [];
let blocked = 0, next = 0, raw = 0;
const t0 = Date.now();
await Promise.all(Array.from({ length: MAPC }, async () => {
  while (next < jobs.length) {
    const [c, t] = jobs[next++];
    const r = await search(c, t, dir);
    times.push(r.ms); counts.push(r.places.length); raw += r.places.length;
    if (r.blocked) blocked++;
    for (const p of r.places) if (!leads.has(p.id)) leads.set(p.id, p.site);
  }
}));
const mapMin = (Date.now() - t0) / 60000;
rm(dir, { recursive: true, force: true });

// Website checks on a sample of the leads that have a website (same check as a search with "contact form" on).
const sites = [...leads.values()].filter(Boolean).sort(() => Math.random() - 0.5).slice(0, CHECKS);
const tally = { open: 0, captcha: 0, none: 0, down: 0, other: 0 }, ctimes = [];
let ci = 0; const t1 = Date.now();
await Promise.all(Array.from({ length: 16 }, async () => {
  while (ci < sites.length) {
    const url = sites[ci++], s0 = Date.now();
    try {
      const r = await checkSite(url, { form: true, email: false });
      if ([FORM.NEEDS_BROWSER, FORM.OPEN, FORM.CAPTCHA].includes(r.form) || (r.form === FORM.NONE && (r.site === SITE.LOADS || r.site === SITE.SLOW))) { try { const b = await browserFormCheck(r.form_url || url); if (b.form !== FORM.NEEDS_BROWSER) Object.assign(r, b); } catch { /* keep */ } }
      if (r.site === SITE.DOWN || r.site === SITE.PARKED || r.site === SITE.BLOCKED) tally.down++;
      else if (r.form === FORM.OPEN) tally.open++; else if (r.form === FORM.CAPTCHA) tally.captcha++; else if (r.form === FORM.NONE) tally.none++; else tally.other++;
    } catch { tally.other++; }
    ctimes.push(Date.now() - s0);
  }
}));
await closeBrowser();
const checkMin = (Date.now() - t1) / 60000;

const withSite = [...leads.values()].filter(Boolean).length, n = sites.length || 1;
const openRate = tally.open / n, siteRate = withSite / Math.max(1, leads.size), usable = openRate * siteRate;
const perSearch = leads.size / jobs.length;
say(`## Lead supply test: ${TERMS.length} trades × ${CITIES.length} cities`);
say('');
say('| Measure | Result |');
say('| --- | --- |');
say(`| Map searches | ${jobs.length} in ${mapMin.toFixed(1)} min (${MAPC} at a time), typical ${(q(times, 0.5) / 1000).toFixed(0)} s, slowest 5% ${(q(times, 0.95) / 1000).toFixed(0)} s |`);
say(`| Google slowdowns (blocked searches) | ${blocked} of ${jobs.length} |`);
say(`| Results | ${raw} total, ${leads.size} unique businesses (${Math.round((1 - leads.size / Math.max(1, raw)) * 100)}% duplicates across searches) |`);
say(`| New businesses per search | ${perSearch.toFixed(0)} |`);
say(`| With a website | ${Math.round(siteRate * 100)}% |`);
say(`| Website checks | ${sites.length} in ${checkMin.toFixed(1)} min, typical ${(q(ctimes, 0.5) / 1000).toFixed(1)} s |`);
say(`| Of checked sites | ${Math.round(tally.open / n * 100)}% open form, ${Math.round(tally.captcha / n * 100)}% CAPTCHA, ${Math.round(tally.none / n * 100)}% no form, ${Math.round(tally.down / n * 100)}% down or parked |`);
say(`| Usable leads (open form) per business found | ${Math.round(usable * 100)}% |`);
const need = usable ? Math.ceil(1000 / usable) : null, searches = need ? Math.ceil(need / Math.max(1, perSearch)) : null;
const minutes = searches ? Math.ceil(searches / jobs.length * mapMin + need * (checkMin / n)) : null;
say('');
say(need ? `To send 1,000 forms a day: about ${need.toLocaleString('en-US')} new businesses a day, roughly ${searches} map searches (new trade and city areas each day), about ${minutes} runner minutes a day.` : 'Not enough data to project.');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join('\n') + '\n');
