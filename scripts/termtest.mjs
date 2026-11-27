// Real Google Maps test: for each industry, which search terms find the most businesses in the trade, and which Google
// categories do those businesses carry? Prints terms, category names and counts only (never business details).
// Env: GMAPS_BIN.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GMAPS = process.env.GMAPS_BIN || './gmaps';
// Industry → [candidate terms, name pattern that clearly says the trade].
const IND = {
  'Roofers': [['roofing contractor', 'roofer', 'roof repair', 'roofing company', 'roof replacement'], /roof/i],
  'Plumbers': [['plumber', 'plumbing contractor', 'drain cleaning service', 'water heater repair', 'emergency plumber'], /plumb|rooter|drain/i],
  'HVAC Contractors': [['hvac contractor', 'air conditioning repair', 'heating and cooling', 'furnace repair', 'ac repair'], /hvac|heating|cooling|air condition|\bair\b|comfort|mechanical/i],
  'Electricians': [['electrician', 'electrical contractor', 'electrical services', 'lighting contractor', 'ev charger installation'], /electric/i],
  'Landscapers': [['landscaper', 'lawn care service', 'landscaping company', 'landscape designer', 'lawn mowing service'], /landscap|lawn|yard|garden|turf/i],
  'General Contractors': [['general contractor', 'construction company', 'home builder', 'custom home builder', 'contractor'], /construct|contract|build|homes\b/i],
  'Remodeling': [['remodeling contractor', 'kitchen remodeler', 'bathroom remodeler', 'home remodeling', 'remodeler'], /remodel|renovat|kitchen|bath/i],
  'House Cleaners': [['house cleaning service', 'maid service', 'cleaning service', 'residential cleaning', 'deep cleaning service'], /clean|maid/i],
  'Pest Control Companies': [['pest control service', 'exterminator', 'termite control', 'pest control company', 'rodent control'], /pest|extermin|termite|bug|mosquito/i],
  'Painters': [['painting contractor', 'house painter', 'painter', 'commercial painting', 'interior painting'], /paint/i],
  'Movers': [['moving company', 'movers', 'moving and storage', 'local movers', 'long distance movers'], /mov(ing|ers)|relocat/i],
  'Tree Service': [['tree service', 'tree removal', 'tree trimming', 'arborist', 'stump grinding'], /tree|arbor|stump/i],
  'Garage Door Companies': [['garage door repair', 'garage door company', 'garage door installation', 'overhead door', 'garage door service'], /garage door|overhead door|\bdoors?\b/i],
  'Windows & Doors': [['window installation', 'window replacement', 'door installation', 'window company', 'replacement windows'], /window|door/i],
  'Pool Construction': [['swimming pool contractor', 'pool builder', 'pool construction', 'pool installation', 'pool remodeling'], /pool/i],
  'Pressure Washing': [['pressure washing service', 'power washing', 'soft washing', 'exterior cleaning', 'house washing'], /wash|clean/i],
  'Floor & Carpet Cleaning': [['carpet cleaning service', 'carpet cleaner', 'tile and grout cleaning', 'upholstery cleaning', 'floor cleaning service'], /carpet|clean|steam|floor|grout/i],
  'Paving': [['paving contractor', 'asphalt paving', 'driveway paving', 'asphalt contractor', 'sealcoating'], /pav|asphalt|seal|concrete/i],
  'Fence Installers': [['fence contractor', 'fence company', 'fence installation', 'fence builder', 'wood fence'], /fenc/i],
  'Dog Groomers': [['dog groomer', 'pet groomer', 'dog grooming', 'mobile dog grooming', 'pet grooming salon'], /groom|pet|dog|paw|pup|canine/i],
};
const CITIES = [[30.2672, -97.7431], [33.749, -84.388], [33.4484, -112.074]];
const GENERIC = new Set(['contractor', 'general contractor', 'construction company', 'service', 'store', 'corporate office', 'business center']);
const dir = await mkdtemp(join(tmpdir(), 'tt-'));
const search = ([lat, lon], term) => new Promise(async (resolve) => {
  const id = Math.random().toString(36).slice(2), qf = join(dir, id + '.txt'), of = join(dir, id + '.jsonl');
  await writeFile(qf, term + '\n');
  const child = spawn(GMAPS, ['-fast-mode', '-geo', `${lat},${lon}`, '-zoom', '13', '-radius', '15000', '-depth', '5', '-input', qf, '-results', of, '-json', '-c', '1', '-exit-on-inactivity', '1m'], { stdio: 'ignore' });
  const killer = setTimeout(() => child.kill('SIGKILL'), 120000);
  child.on('close', async () => {
    clearTimeout(killer); const out = [];
    try { for (const line of (await readFile(of, 'utf8')).split('\n')) { if (!line.trim()) continue; let v; try { v = JSON.parse(line); } catch { continue; } for (const o of (Array.isArray(v) ? v : [v])) if (o && (o.place_id || o.cid)) { const cats = Array.isArray(o.categories) ? o.categories : []; out.push({ id: o.place_id || o.cid, name: o.title || '', main: (typeof o.category === 'string' && o.category) || cats[0] || null, cats: [...new Set([o.category, ...cats].filter(Boolean))] }); } } } catch { /* none */ }
    rm(qf, { force: true }); rm(of, { force: true }); resolve(out);
  });
});

const jobs = Object.entries(IND).flatMap(([ind, [terms]]) => terms.flatMap(t => CITIES.map(c => ({ ind, t, c }))));
const got = {}; let i = 0, done = 0;
await Promise.all(Array.from({ length: 4 }, async () => { while (i < jobs.length) { const { ind, t, c } = jobs[i++]; const r = await search(c, t); ((got[ind] ||= {})[t] ||= []).push(...r); if (++done % 30 === 0) console.log(`${done}/${jobs.length} searches`); } }));
rm(dir, { recursive: true, force: true });

const out = []; const say = (s = '') => { console.log(s); out.push(s); };
const result = {};
say(`## Real Google Maps test: ${Object.keys(IND).length} industries × 5 terms × ${CITIES.length} cities`);
for (const [ind, [terms, nameRe]] of Object.entries(IND)) {
  const all = new Map(); for (const t of terms) for (const p of got[ind]?.[t] || []) all.set(p.id, p);
  // The trade's core category: the most common main category across every result.
  const mains = {}; for (const p of all.values()) if (p.main) mains[p.main] = (mains[p.main] || 0) + 1;
  const core = Object.entries(mains).sort((a, b) => b[1] - a[1])[0]?.[0];
  // In the trade: carries the core category (main or secondary) or its name clearly says the trade.
  const inTrade = p => (core && p.cats.includes(core)) || nameRe.test(p.name);
  // Terms: most in-trade businesses first, then whichever adds the most new in-trade businesses.
  const sets = Object.fromEntries(terms.map(t => [t, new Set((got[ind]?.[t] || []).filter(inTrade).map(p => p.id))]));
  const order = [], covered = new Set();
  while (order.length < 3) {
    const best = terms.filter(t => !order.includes(t)).map(t => [t, [...sets[t]].filter(id => !covered.has(id)).length]).sort((a, b) => b[1] - a[1])[0];
    if (!best) break; order.push(best[0]); for (const id of sets[best[0]]) covered.add(id);
  }
  // Categories: every category that in-trade businesses carry often enough, and where most businesses carrying it are in the trade.
  const trade = [...all.values()].filter(inTrade);
  const catN = {}, catTrade = {};
  for (const p of all.values()) for (const c of p.cats) { catN[c] = (catN[c] || 0) + 1; if (inTrade(p)) catTrade[c] = (catTrade[c] || 0) + 1; }
  const accepted = Object.keys(catTrade).filter(c => !GENERIC.has(c.toLowerCase()) && catTrade[c] >= Math.max(2, trade.length * 0.03) && catTrade[c] / catN[c] >= 0.7).sort((a, b) => catTrade[b] - catTrade[a]).slice(0, 10);
  if (core && !accepted.includes(core)) accepted.unshift(core);
  // Recall check: in-trade businesses the accepted categories would still keep (the name rule catches the rest).
  const kept = trade.filter(p => p.cats.some(c => accepted.includes(c))).length;
  result[ind] = { terms: order, categories: accepted };
  say(`\n### ${ind}: ${all.size} businesses, ${trade.length} in the trade (core category: ${core})`);
  say(`- Terms, best first: ${order.map(t => `${t} (${sets[t].size})`).join(', ')} · all 5 terms together: ${new Set(Object.values(sets).flatMap(s => [...s])).size}, best two: ${new Set([...sets[order[0]], ...(sets[order[1]] || [])]).size}`);
  say(`- Accepted categories: ${accepted.map(c => `${c} (${catTrade[c] || 0})`).join(', ')}`);
  say(`- Categories keep ${kept} of ${trade.length} in-trade businesses (${Math.round(kept / Math.max(1, trade.length) * 100)}%); the name rule keeps the rest`);
}
console.log('RESULT ' + JSON.stringify(result));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join('\n') + '\n');
