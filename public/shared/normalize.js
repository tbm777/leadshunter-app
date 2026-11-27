// Normalisation helpers shared by the Worker, the runner and tests.

// Domains shared by many unrelated businesses. Never used to detect duplicates.
const SHARED = ['facebook.com', 'fb.com', 'instagram.com', 'linktr.ee', 'yelp.com', 'google.com', 'sites.google.com', 'business.site',
  'g.page', 'goo.gl', 'nextdoor.com', 'angi.com', 'angieslist.com', 'homeadvisor.com', 'thumbtack.com', 'houzz.com', 'bbb.org',
  'yellowpages.com', 'wixsite.com', 'squarespace.com', 'godaddysites.com', 'weebly.com', 'wordpress.com', 'square.site', 'mapquest.com',
  'linkedin.com', 'twitter.com', 'x.com', 'tiktok.com', 'youtube.com', 'porch.com', 'booksy.com', 'vagaro.com', 'setmore.com'];
// Social networks and directories: a profile page on these is not the business's own website (and its forms are the platform's, like signups).
const SOCIAL = ['facebook.com', 'fb.com', 'instagram.com', 'linktr.ee', 'yelp.com', 'nextdoor.com', 'linkedin.com', 'twitter.com', 'x.com', 'tiktok.com', 'youtube.com', 'pinterest.com',
  'houzz.com', 'houzz.co.uk', 'houzz.com.au', 'angi.com', 'angieslist.com', 'homeadvisor.com', 'thumbtack.com', 'bbb.org', 'porch.com', 'buildzoom.com', 'yellowpages.com', 'yellowpages.ca',
  'yellowpages.com.au', 'superpages.com', 'manta.com', 'mapquest.com', 'alignable.com', 'expertise.com', 'networx.com', 'bark.com', 'homeguide.com', 'fixr.com', 'birdeye.com',
  'chamberofcommerce.com', 'local.com', 'groupon.com', 'hipages.com.au', 'oneflare.com.au', 'truelocal.com.au', 'yelp.ca', 'yelp.com.au', 'trustpilot.com', 'zillow.com', 'realtor.com',
  'dubizzle.com', 'yello.ae', 'google.com', 'goo.gl', 'g.page', 'maps.app.goo.gl', 'linkedin.cn', 'threads.net', 'tripadvisor.com', 'opentable.com', 'doordash.com', 'ubereats.com', 'grubhub.com'];

const endsWith = (host, list) => list.some(d => host === d || host.endsWith('.' + d));

/** Clean a website URL from Google Maps. Returns a full https URL or null. */
export function cleanWebsite(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();
  try {
    if (s.startsWith('/url?') || s.includes('google.com/url?')) {
      const u = new URL(s, 'https://www.google.com');
      s = u.searchParams.get('q') || u.searchParams.get('url') || '';
    }
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    const u = new URL(s);
    if (!u.hostname.includes('.')) return null;
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|gclid|fbclid|y_source|cid$)/i.test(k)) u.searchParams.delete(k);
    u.hash = '';
    return u.toString();
  } catch { return null; }
}

/** Registrable-ish domain for duplicate detection: lower case, no www, no path. */
export function domainOf(url) {
  if (!url) return null;
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\d?\./, '').replace(/\.$/, '');
    return h || null;
  } catch { return null; }
}

export function isSharedDomain(domain) { return !!domain && endsWith(domain, SHARED); }
export function isSocialHost(host) { return !!host && endsWith(host.toLowerCase().replace(/^www\./, ''), SOCIAL); }

const CC = { US: '1', CA: '1', AU: '61', AE: '971' };

/** Phone to E.164. Country is a two-letter code used when the number has no country prefix. */
export function phoneE164(raw, country) {
  if (!raw) return null;
  const plus = String(raw).trim().startsWith('+');
  let d = String(raw).replace(/\D/g, '');
  if (!d) return null;
  if (plus) return d.length >= 8 ? '+' + d : null;
  const cc = CC[country] || '1';
  if (cc === '1') {
    if (d.length === 11 && d.startsWith('1')) return '+' + d;
    if (d.length === 10) return '+1' + d;
    return null;
  }
  if (cc === '61') {
    if (d.startsWith('61') && d.length === 11) return '+' + d;
    if (d.startsWith('0')) d = d.slice(1);
    return d.length === 9 ? '+61' + d : null;
  }
  if (cc === '971') {
    if (d.startsWith('971') && (d.length === 11 || d.length === 12)) return '+' + d;
    if (d.startsWith('00971')) return '+' + d.slice(2);
    if (d.startsWith('0')) d = d.slice(1);
    return d.length === 8 || d.length === 9 ? '+971' + d : null;
  }
  return null;
}

/** Map a country name or code from Google to our two-letter code. */
export function countryCode(v, fallback = null) {
  if (!v) return fallback;
  const s = String(v).trim().toLowerCase();
  if (s === 'us' || s === 'usa' || s.includes('united states')) return 'US';
  if (s === 'ca' || s === 'canada') return 'CA';
  if (s === 'au' || s === 'aus' || s === 'australia') return 'AU';
  if (s === 'ae' || s === 'uae' || s.includes('united arab emirates') || s === 'الإمارات العربية المتحدة') return 'AE';
  return fallback;
}

/** Does a Google category match one of the industry's accepted categories? Empty list accepts everything. */
// Words in search terms that say nothing about the trade itself.
const GENERIC = new Set(['service', 'services', 'contractor', 'contractors', 'company', 'companies', 'repair', 'installation', 'install', 'builder', 'builders', 'commercial', 'residential', 'home', 'house', 'local', 'and', 'the', 'for', 'mobile', 'removal', 'designer', 'supplier', 'store', 'shop', 'general', 'expert', 'pro', 'pros']);
/**
 * The trade named by an industry's first (best) search term, as a name pattern: "roofing contractor" → /\broof/,
 * "garage door repair" → /\bgarage\w*\s+door/ (so an auto "garage" doesn't match). Null when the term is too generic.
 */
export function tradePattern(terms) {
  const words = String((terms || [])[0] || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 3 && !GENERIC.has(w));
  if (!words.length) return null;
  const stem = w => { const x = w.replace(/(ing|ers|er|ians|ian|s)$/, ''); return x.length >= 4 ? x : w; };
  if (words.length === 1 && stem(words[0]).length < 4) return null;
  return new RegExp('\\b' + words.map(stem).join('\\w*\\s+'));
}
// Names that clearly say the trade, per industry (from the real Google Maps test). Other industries fall back to the first term.
const TRADE_NAMES = {
  'roofers': /\broof/, 'plumbers': /\bplumb|\brooter|\bdrain/, 'hvac contractors': /\bhvac|\bheating|\bcooling|air condition|\bmechanical|\bcomfort/,
  'electricians': /\belectric/, 'landscapers': /\blandscap|\blawn|\byard|\bturf/, 'remodeling': /\bremodel|\brenovat/,
  'house cleaners': /\bclean|\bmaid/, 'pest control companies': /\bpest|\bextermin|\btermite|\bmosquito/, 'painters': /\bpaint/,
  'movers': /\bmoving\b|\bmovers?\b|\brelocat/, 'tree service': /\btree|\barbor|\bstump/, 'garage door companies': /garage\s+doors?|overhead\s+doors?/,
  'windows & doors': /\bwindows?\b|\bdoors?\b/, 'pool construction': /\bpools?\b/, 'pressure washing': /pressure\s+wash|power\s+wash|soft\s+wash|\bwashing\b/,
  'floor & carpet cleaning': /\bcarpet|\bsteam|\bgrout|\bupholster/, 'paving': /\bpav|\basphalt|\bsealcoat/, 'fence installers': /\bfenc/,
  'dog groomers': /\bgroom|\bpaws?\b|\bpups?\b|\bcanine|\bdoggie|\bdog\b/,
};
export function tradeNamePattern(industryName, terms) { return TRADE_NAMES[String(industryName || '').trim().toLowerCase()] || tradePattern(terms); }
/** Keep a business whose name clearly says the trade ("ABC Roofing" filed under "Contractor"). */
export function categoryAccepted(accepted, category, categories, name = '', terms = [], industryName = '') {
  if (!accepted || !accepted.length) return true;
  const want = new Set(accepted.map(c => c.trim().toLowerCase()));
  const have = [category, ...(Array.isArray(categories) ? categories : [])].filter(Boolean).map(c => String(c).trim().toLowerCase());
  if (have.some(c => want.has(c))) return true;
  const re = tradeNamePattern(industryName, terms), n = String(name || '').toLowerCase();
  return !!(re && n && re.test(n));
}

const COUNTRY_WORDS = /^(united states|usa|us|canada|australia|united arab emirates|uae)$/i;
const AU_STATES = 'NSW|VIC|QLD|SA|WA|TAS|NT|ACT';
const AE_CITIES = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain', 'Al Ain'];

/** Split a one-line Google address into city, region and postal code. Country is a two-letter hint. */
export function parseAddress(address, country) {
  const out = { city: null, region: null, postal: null };
  if (!address || typeof address !== 'string') return out;
  let parts = address.split(',').map(s => s.trim()).filter(Boolean);
  while (parts.length && COUNTRY_WORDS.test(parts[parts.length - 1])) parts.pop();
  if (!parts.length) return out;
  const last = parts[parts.length - 1];
  if (country === 'AE' || / - /.test(last)) {
    const segs = parts.join(' - ').split(/\s+-\s+/).map(s => s.trim()).filter(s => s && !COUNTRY_WORDS.test(s));
    const hit = [...segs].reverse().find(s => AE_CITIES.some(c => c.toLowerCase() === s.toLowerCase()));
    out.city = hit || segs[segs.length - 1] || null;
    out.region = hit || null;
    return out;
  }
  let m;
  if ((m = last.match(new RegExp(`^(.*?)\\s+(${AU_STATES})\\s*(\\d{4})?$`)))) {
    out.city = m[1] || (parts.length > 1 ? parts[parts.length - 2] : null); out.region = m[2]; out.postal = m[3] || null; return out;
  }
  if ((m = last.match(/^([A-Z]{2})(?:\s+([0-9]{5}(?:-[0-9]{4})?|[A-Z][0-9][A-Z]\s?[0-9][A-Z][0-9]))?$/))) {
    out.region = m[1]; out.postal = m[2] || null; out.city = parts.length > 1 ? parts[parts.length - 2] : null; return out;
  }
  if ((m = last.match(new RegExp(`^(${AU_STATES})\\s+(\\d{4})$`)))) { out.region = m[1]; out.postal = m[2]; out.city = parts.length > 1 ? parts[parts.length - 2] : null; return out; }
  out.city = parts.length > 1 ? last : null;
  return out;
}

/** Make phone numbers readable: (973)538-3910 → (973) 538-3910. Leaves other formats alone. */
export function prettyPhone(raw) {
  if (!raw) return raw;
  const s = String(raw).trim();
  const d = s.replace(/\D/g, '');
  if (/^\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/.test(s) && d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (/^\+1/.test(s) && d.length === 11) return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return s.replace(/\s{2,}/g, ' ');
}
