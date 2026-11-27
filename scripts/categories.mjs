// Which Google Maps categories do each industry's search results really have? Runs each industry's first two terms in two
// cities and tallies the categories Google returns. Prints category names and counts only (never business details).
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, GMAPS_BIN.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOKEN = process.env.CLOUDFLARE_API_TOKEN, ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID, GMAPS = process.env.GMAPS_BIN || './gmaps';
const cf = async (path, body) => { const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!j.success) throw new Error(JSON.stringify(j.errors).slice(0, 200)); return j.result; };
const db = (await cf('/d1/database?name=leadshunter')).find(d => d.name === 'leadshunter');
const inds = (await cf(`/d1/database/${db.uuid}/query`, { sql: 'SELECT name, terms, categories FROM industries WHERE archived = 0 ORDER BY position' }))[0].results;
const CITIES = [[30.2672, -97.7431], [33.749, -84.388]];
const dir = await mkdtemp(join(tmpdir(), 'cat-'));
const search = ([lat, lon], term) => new Promise(async (resolve) => {
  const id = Math.random().toString(36).slice(2), qf = join(dir, id + '.txt'), of = join(dir, id + '.jsonl');
  await writeFile(qf, term + '\n');
  const child = spawn(GMAPS, ['-fast-mode', '-geo', `${lat},${lon}`, '-zoom', '13', '-radius', '15000', '-depth', '5', '-input', qf, '-results', of, '-json', '-c', '1', '-exit-on-inactivity', '1m'], { stdio: 'ignore' });
  const killer = setTimeout(() => child.kill('SIGKILL'), 120000);
  child.on('close', async () => {
    clearTimeout(killer); const out = [];
    try { for (const line of (await readFile(of, 'utf8')).split('\n')) { if (!line.trim()) continue; let v; try { v = JSON.parse(line); } catch { continue; } for (const o of (Array.isArray(v) ? v : [v])) if (o) out.push({ main: o.category || null, all: Array.isArray(o.categories) ? o.categories : [] }); } } catch { /* none */ }
    rm(qf, { force: true }); rm(of, { force: true }); resolve(out);
  });
});
const out = []; const say = (s = '') => { console.log(s); out.push(s); };
const jobs = inds.flatMap(ind => JSON.parse(ind.terms || '[]').slice(0, 2).flatMap(t => CITIES.map(c => ({ ind, t, c }))));
const tally = {}; let i = 0;
await Promise.all(Array.from({ length: 4 }, async () => { while (i < jobs.length) { const { ind, t, c } = jobs[i++]; for (const r of await search(c, t)) { const m = (tally[ind.name] ||= { main: {}, n: 0 }); m.n++; if (r.main) m.main[r.main] = (m.main[r.main] || 0) + 1; } } }));
rm(dir, { recursive: true, force: true });
say('## Google categories found per industry (main category of each result; ✓ = currently accepted)');
for (const ind of inds) {
  const t = tally[ind.name]; if (!t) { say(`\n### ${ind.name}: no results`); continue; }
  const acc = JSON.parse(ind.categories || '[]').map(x => x.toLowerCase());
  say(`\n### ${ind.name} (${t.n} results)`);
  for (const [cat, n] of Object.entries(t.main).sort((a, b) => b[1] - a[1]).slice(0, 12)) say(`- ${acc.includes(cat.toLowerCase()) ? '✓' : '·'} ${cat}: ${n}`);
  const missing = acc.filter(a => !Object.keys(t.main).some(k => k.toLowerCase() === a));
  if (missing.length) say(`- not seen in results: ${missing.join(', ')}`);
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join('\n') + '\n');
