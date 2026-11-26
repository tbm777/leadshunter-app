// Normalisation helpers shared by the Worker, the runner and tests.

// Domains shared by many unrelated businesses. Never used to detect duplicates.
const SHARED = ['facebook.com', 'fb.com', 'instagram.com', 'linktr.ee', 'yelp.com', 'google.com', 'sites.google.com', 'business.site',
  'g.page', 'goo.gl', 'nextdoor.com', 'angi.com', 'angieslist.com', 'homeadvisor.com', 'thumbtack.com', 'houzz.com', 'bbb.org',
  'yellowpages.com', 'wixsite.com', 'squarespace.com', 'godaddysites.com', 'weebly.com', 'wordpress.com', 'square.site', 'mapquest.com',
  'linkedin.com', 'twitter.com', 'x.com', 'tiktok.com', 'youtube.com', 'porch.com', 'booksy.com', 'vagaro.com', 'setmore.com'];
const SOCIAL = ['facebook.com', 'fb.com', 'instagram.com', 'linktr.ee', 'yelp.com', 'nextdoor.com', 'linkedin.com', 'twitter.com', 'x.com', 'tiktok.com', 'youtube.com'];

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

const CC = { US: '1', CA: '1', MA: '212' };

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
  if (cc === '212') {
    if (d.startsWith('212')) return '+' + d;
    if (d.startsWith('0')) d = d.slice(1);
    return d.length === 9 ? '+212' + d : null;
  }
  return null;
}

/** Map a country name or code from Google to our two-letter code. */
export function countryCode(v, fallback = null) {
  if (!v) return fallback;
  const s = String(v).trim().toLowerCase();
  if (s === 'us' || s === 'usa' || s.includes('united states')) return 'US';
  if (s === 'ca' || s === 'canada') return 'CA';
  if (s === 'ma' || s === 'morocco' || s === 'maroc' || s === 'المغرب') return 'MA';
  return fallback;
}

/** Does a Google category match one of the industry's accepted categories? Empty list accepts everything. */
export function categoryAccepted(accepted, category, categories) {
  if (!accepted || !accepted.length) return true;
  const want = new Set(accepted.map(c => c.trim().toLowerCase()));
  const have = [category, ...(Array.isArray(categories) ? categories : [])].filter(Boolean).map(c => String(c).trim().toLowerCase());
  return have.some(c => want.has(c));
}
