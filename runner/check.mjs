// Website checks: does it load, how fast, platform, contact form, CAPTCHA, email.
// Plain HTTP first. Sites that need JavaScript to show a form are flagged for a browser check.
import { isSocialHost } from '../public/shared/normalize.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MAX_BYTES = 1_500_000;
export const SITE = { LOADS: 0, SLOW: 1, DOWN: 2, NOT_CHECKED: 3, NONE: 4, BLOCKED: 5, PARKED: 6, SOCIAL: 7 };
export const FORM = { OPEN: 0, CAPTCHA: 1, NONE: 2, NOT_CHECKED: 3, NEEDS_BROWSER: 4 };

async function fetchPage(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9' } });
    let html = '';
    const type = res.headers.get('content-type') || '';
    if (res.body && (type.includes('html') || type === '' || type.includes('text'))) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        html += dec.decode(value, { stream: true });
        if (size > MAX_BYTES) { ctrl.abort(); break; }
      }
    }
    return { ok: true, status: res.status, url: res.url || url, html, ms: Date.now() - t0, headers: res.headers };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : (e.cause && e.cause.code) || e.message, ms: Date.now() - t0 };
  } finally { clearTimeout(timer); }
}

const BLOCK_MARKERS = [/cf-chl|challenge-platform|cf_chl_opt/i, /<title>\s*(just a moment|attention required|access denied|403 forbidden)/i, /captcha-delivery\.com|datadome/i, /sgcaptcha|perimeterx|px-captcha/i, /incapsula|_Incapsula_Resource/i];
const PARKED_MARKERS = [/this domain (name )?(is|may be) for sale/i, /buy this domain/i, /domain is parked/i, /parked free/i, /sedoparking|parkingcrew|bodis\.com|dan\.com\/buy|afternic/i,
  /godaddy\.com\/domainsearch|domain-for-sale/i, /this site can.?t be reached|website coming soon|under construction/i, /hugedomains/i, /account (has been )?suspended/i];

export function detectPlatform(html) {
  const h = html.slice(0, 400000);
  if (/wp-content|wp-includes|<meta[^>]+generator[^>]+wordpress/i.test(h)) return 'WordPress';
  if (/static\.wixstatic\.com|wix\.com|_wixCIDX|wix-essential/i.test(h)) return 'Wix';
  if (/squarespace\.com|static1\.squarespace|Static\.SQUARESPACE/i.test(h)) return 'Squarespace';
  if (/webflow\.(com|io)|data-wf-page/i.test(h)) return 'Webflow';
  if (/img1\.wsimg\.com|godaddy|websites\.godaddy/i.test(h)) return 'GoDaddy';
  if (/cdn\.shopify\.com|Shopify\.theme/i.test(h)) return 'Shopify';
  if (/duda(mobile)?\.com|dmCssTemplate|multiscreensite/i.test(h)) return 'Duda';
  if (/weebly\.com|editmysite\.com/i.test(h)) return 'Weebly';
  if (/hubspot|hs-scripts\.com|hsforms/i.test(h) && /hs-sites|hubspotusercontent/i.test(h)) return 'HubSpot';
  return 'Custom';
}
const JS_PLATFORMS = new Set(['Wix', 'Squarespace', 'Webflow', 'Duda', 'GoDaddy', 'Weebly']);

export function detectCaptcha(html) {
  if (/challenges\.cloudflare\.com\/turnstile|cf-turnstile/i.test(html)) return 'Turnstile';
  if (/hcaptcha\.com|h-captcha/i.test(html)) return 'hCaptcha';
  if (/recaptcha\/(api|enterprise)\.js|g-recaptcha|grecaptcha|recaptcha_public_key|www\.google\.com\/recaptcha/i.test(html)) return 'reCAPTCHA';
  if (/friendlycaptcha|frc-captcha/i.test(html)) return 'Friendly Captcha';
  return null;
}

const EMBEDS = [/jotform\.(com|us)\/(jsform|[0-9])/i, /js\.hsforms\.net|hsforms\.com|hbspt\.forms/i, /typeform\.com\/to\//i, /docs\.google\.com\/forms/i,
  /formstack\.com\/forms/i, /wufoo\.com/i, /cognitoforms\.com/i, /forms\.zohopublic|zoho\.com\/forms/i, /123formbuilder/i, /paperform\.co/i, /tally\.so\/embed/i, /form\.jotformpro/i, /podium\.com|widget\.podium/i, /housecallpro\.com|book\.housecallpro/i, /servicetitan|scheduler\.servicetitan/i, /getjobber\.com|clienthub\.getjobber/i];

/** Find a contact form in raw HTML. Returns {found, embed, captcha}. */
export function detectForm(html) {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) || [];
  for (const f of forms) {
    const tag = (f.match(/<form\b[^>]*>/i) || [''])[0];
    if (/role=["']?search|class=["'][^"']*search|action=["'][^"']*(search|login|cart|subscribe|newsletter)/i.test(tag)) continue;
    const hasTextarea = /<textarea\b/i.test(f);
    const msgField = /name=["'][^"']*(message|comment|details|inquiry|enquiry|question|project|description)/i.test(f);
    const hasContact = /type=["']?email|name=["'][^"']*(email|phone|tel)/i.test(f);
    if ((hasTextarea || msgField) && hasContact) return { found: true, embed: false, captcha: detectCaptcha(f) || detectCaptcha(html) };
  }
  if (EMBEDS.some(re => re.test(html))) return { found: true, embed: true, captcha: detectCaptcha(html) };
  return { found: false };
}

const CONTACT_LINK = /(contact|get-in-touch|getintouch|reach-us|request|quote|estimate|appointment|book|schedule|consult|free-inspection|enquir|inquir)/i;
export function contactLinks(html, baseUrl) {
  const out = [];
  const base = new URL(baseUrl);
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 20) {
    const href = m[1], text = m[2].replace(/<[^>]+>/g, ' ');
    if (!CONTACT_LINK.test(href) && !CONTACT_LINK.test(text)) continue;
    try {
      const u = new URL(href, base);
      if (!/^https?:$/.test(u.protocol)) continue;
      if (u.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
      if (/\.(pdf|jpg|jpeg|png|gif|webp|svg|zip|docx?)$/i.test(u.pathname)) continue;
      u.hash = '';
      const s = u.toString();
      if (!out.includes(s) && s !== base.toString()) out.push(s);
    } catch { /* bad link */ }
  }
  // Prefer links that literally say contact.
  return out.sort((a, b) => (/contact/i.test(b) ? 1 : 0) - (/contact/i.test(a) ? 1 : 0)).slice(0, 3);
}

const BAD_EMAIL = /(example\.(com|org)|sentry|wixpress|domain\.com|email\.com|yourdomain|your-?email|@2x|\.png|\.jpg|\.gif|\.webp|\.svg|godaddy\.com|squarespace\.com|schema\.org|w3\.org|cloudflare)/i;
export function findEmail(html, domain) {
  const found = new Set();
  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) found.add(decodeURIComponent(m[1]).toLowerCase());
  for (const m of html.matchAll(/[a-z0-9._%+-]{1,64}@[a-z0-9.-]+\.[a-z]{2,24}/gi)) found.add(m[0].toLowerCase());
  const list = [...found].filter(e => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e) && !BAD_EMAIL.test(e));
  const own = domain ? list.filter(e => e.endsWith('@' + domain) || e.endsWith('.' + domain)) : [];
  return own[0] || list[0] || null;
}

/**
 * Check one website. opts: { form: boolean, email: boolean }.
 * Returns { site, ms, platform, form, form_url, captcha, email, final_url }.
 */
export async function checkSite(url, opts = {}) {
  try { if (isSocialHost(new URL(url).hostname)) return { site: SITE.SOCIAL, ms: null, final_url: url, form: opts.form ? FORM.NONE : null }; } catch { return { site: SITE.DOWN, ms: null, form: opts.form ? FORM.NOT_CHECKED : null }; }
  let r = await fetchPage(url, 10000);
  if (!r.ok || r.status >= 500) {
    await new Promise(res => setTimeout(res, 1500));
    const again = await fetchPage(url, 15000);
    if (again.ok) r = again;
  }
  if (!r.ok) {
    // Some sites only answer on http or without www.
    try {
      const u = new URL(url);
      const alt = u.hostname.startsWith('www.') ? url.replace('://www.', '://') : url.replace('https://', 'http://');
      const third = await fetchPage(alt, 10000);
      if (third.ok) r = third;
    } catch { /* ignore */ }
  }
  if (!r.ok) return { site: SITE.DOWN, ms: null, form: opts.form ? FORM.NOT_CHECKED : null, note: r.error };
  const host = new URL(r.url).hostname;
  if (isSocialHost(host)) return { site: SITE.SOCIAL, ms: r.ms, final_url: r.url, form: opts.form ? FORM.NONE : null };
  if ((r.status === 403 || r.status === 429 || r.status === 503) && BLOCK_MARKERS.some(re => re.test(r.html))) return { site: SITE.BLOCKED, ms: r.ms, final_url: r.url, form: opts.form ? FORM.NOT_CHECKED : null };
  if (r.status === 403 || r.status === 401) return { site: SITE.BLOCKED, ms: r.ms, final_url: r.url, form: opts.form ? FORM.NOT_CHECKED : null };
  if (r.status >= 400) return { site: SITE.DOWN, ms: r.ms, final_url: r.url, form: opts.form ? FORM.NOT_CHECKED : null, note: 'HTTP ' + r.status };
  const text = r.html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (PARKED_MARKERS.some(re => re.test(r.html.slice(0, 60000))) && text.length < 4000) return { site: SITE.PARKED, ms: r.ms, final_url: r.url, form: opts.form ? FORM.NONE : null };

  const out = { site: r.ms > 5000 ? SITE.SLOW : SITE.LOADS, ms: r.ms, final_url: r.url, platform: detectPlatform(r.html), form: null, captcha: null, email: null };
  let domain = null; try { domain = new URL(r.url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
  let pages = [r];
  if (opts.form || opts.email) {
    let f = detectForm(r.html);
    let formUrl = f.found ? r.url : null;
    const links = contactLinks(r.html, r.url);
    for (const link of links) {
      if (f.found && (!opts.email || out.email)) break;
      const sub = await fetchPage(link, 10000);
      if (!sub.ok || sub.status >= 400) continue;
      pages.push(sub);
      if (!f.found) { const g = detectForm(sub.html); if (g.found) { f = g; formUrl = sub.url; } }
    }
    if (opts.form) {
      if (f.found) { out.form = f.captcha ? FORM.CAPTCHA : FORM.OPEN; out.captcha = f.captcha || null; out.form_url = formUrl; }
      else if (JS_PLATFORMS.has(out.platform) || text.length < 600) { out.form = FORM.NEEDS_BROWSER; out.form_url = links[0] || r.url; }
      else out.form = FORM.NONE;
    }
    if (opts.email) { for (const p of pages) { out.email = findEmail(p.html, domain); if (out.email) break; } }
  }
  return out;
}
