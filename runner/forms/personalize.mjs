// Merge tags for subjects, messages and files: [Company Name], {company}, {{company}} and friends.

// Google Maps names are often stuffed with keywords: "ABC Plumbing - 24/7 Emergency Plumber Austin TX".
export function cleanCompanyName(name) {
  let n = String(name || '').replace(/\s+/g, ' ').trim();
  const cut = n.split(/\s+[-–—|•:]\s+|\s*\|\s*/)[0];
  if (cut && cut.length >= 3) n = cut;
  n = n.replace(/\(.*?\)/g, '').replace(/,?\s+(llc|l\.l\.c\.|inc\.?|incorporated|ltd\.?|corp\.?|corporation|pllc|pty\.? ltd\.?)$/i, '').trim();
  if (n === n.toUpperCase() && /[A-Z]{4}/.test(n)) n = n.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
  return n || String(name || '').trim();
}

const TAGS = {
  'company name': l => cleanCompanyName(l.name), company: l => cleanCompanyName(l.name), business: l => cleanCompanyName(l.name), 'business name': l => cleanCompanyName(l.name),
  city: l => l.city || '', state: l => l.state || '', industry: l => l.industry || '', category: l => l.category || '', website: l => l.domain || l.website || '',
};
const FALLBACK = { 'company name': 'your company', company: 'your company', business: 'your business', 'business name': 'your business', city: 'your area' };

export function personalize(text, lead = {}) {
  const sub = (_, raw) => {
    const k = raw.trim().toLowerCase().replace(/[_-]+/g, ' ');
    if (!(k in TAGS)) return _;
    return TAGS[k](lead) || FALLBACK[k] || '';
  };
  return String(text || '').replace(/\{\{\s*([\w -]+?)\s*\}\}/g, sub).replace(/\[([\w -]+?)\]/g, sub).replace(/\{([\w -]+?)\}/g, sub);
}
