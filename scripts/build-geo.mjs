// Builds public/geo/*.json from GeoNames (CC BY 4.0, https://www.geonames.org). Runs in the deploy workflow.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'public/geo';
const TMP = '.geo-tmp';
const COUNTRIES = ['US', 'CA', 'AU', 'AE'];
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

async function download(url, file) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return true;
    } catch (e) {
      console.log(`Download failed (${url}): ${e.message}. Retrying…`);
      await new Promise(r => setTimeout(r, 3000 * (i + 1)));
    }
  }
  return false;
}
const unzip = (zip, member) => execFileSync('unzip', ['-p', zip, member], { maxBuffer: 1 << 30 }).toString('utf8');

// Canadian provinces use numbers in GeoNames admin1 codes; show the usual abbreviations instead.
const CA_ABBR = { '01': 'AB', '02': 'BC', '03': 'MB', '04': 'NB', '05': 'NL', '07': 'NS', '08': 'ON', '09': 'PE', '10': 'QC', '11': 'SK', '12': 'YT', '13': 'NT', '14': 'NU' };
// Australian states also use numbers in GeoNames.
const AU_ABBR = { '01': 'ACT', '02': 'NSW', '03': 'NT', '04': 'QLD', '05': 'SA', '06': 'TAS', '07': 'VIC', '08': 'WA' };
const ABBR = { CA: CA_ABBR, AU: AU_ABBR };

const base = 'https://download.geonames.org/export';
if (!await download(`${base}/dump/cities5000.zip`, join(TMP, 'cities.zip'))) throw new Error('Could not download GeoNames cities.');
if (!await download(`${base}/dump/admin1CodesASCII.txt`, join(TMP, 'admin1.txt'))) throw new Error('Could not download GeoNames regions.');

const admin = {};
for (const line of readFileSync(join(TMP, 'admin1.txt'), 'utf8').split('\n')) {
  const [code, name] = line.split('\t');
  if (!code) continue;
  const [cc, a1] = code.split('.');
  if (!COUNTRIES.includes(cc)) continue;
  const key = ABBR[cc] ? (ABBR[cc][a1] || a1) : a1;
  (admin[cc] ||= {})[key] = { name, raw: a1 };
}

const places = {};
for (const cc of COUNTRIES) places[cc] = { regions: {}, cities: [] };
for (const [cc, regs] of Object.entries(admin)) for (const [k, v] of Object.entries(regs)) places[cc].regions[k] = v.name;

const rawToKey = {};
for (const [cc, regs] of Object.entries(admin)) for (const [k, v] of Object.entries(regs)) rawToKey[cc + '.' + v.raw] = k;

for (const line of unzip(join(TMP, 'cities.zip'), 'cities5000.txt').split('\n')) {
  const f = line.split('\t');
  if (f.length < 15) continue;
  const cc = f[8];
  if (!COUNTRIES.includes(cc)) continue;
  if (!/^PPL/.test(f[7])) continue;
  const region = rawToKey[cc + '.' + f[10]] || f[10];
  places[cc].cities.push([f[1], f[2], region, +(+f[4]).toFixed(4), +(+f[5]).toFixed(4), +f[14] || 0]);
}
for (const cc of COUNTRIES) places[cc].cities.sort((a, b) => b[5] - a[5]);
writeFileSync(join(OUT, 'places.json'), JSON.stringify(places));
console.log('places.json:', COUNTRIES.map(cc => `${cc} ${places[cc].cities.length} cities, ${Object.keys(places[cc].regions).length} regions`).join('; '));

for (const cc of COUNTRIES) {
  const file = join(TMP, `postal-${cc}.zip`);
  if (!await download(`${base}/zip/${cc}.zip`, file)) { console.log(`No postal codes for ${cc}; postal search will be unavailable there.`); continue; }
  const map = {};
  for (const line of unzip(file, `${cc}.txt`).split('\n')) {
    const f = line.split('\t');
    if (f.length < 11 || !f[1]) continue;
    const code = f[1].toUpperCase().replace(/\s+/g, ' ').trim();
    if (map[code]) continue;
    map[code] = [+(+f[9]).toFixed(4), +(+f[10]).toFixed(4), f[2], f[4] || f[3]];
  }
  writeFileSync(join(OUT, `postal-${cc}.json`), JSON.stringify(map));
  console.log(`postal-${cc}.json: ${Object.keys(map).length} codes`);
}
writeFileSync(join(OUT, 'ATTRIBUTION.txt'), 'Place and postal data from GeoNames (https://www.geonames.org), licensed under CC BY 4.0.\n');
