// One definition of "CAPTCHA", used by the website check, the browser check and the form robot.
// visible   = a challenge a person must solve (checkbox, puzzle, Turnstile box): goes to the manual queue.
// invisible = a background score check with only a badge (reCAPTCHA v3, invisible v2): a person is never asked anything, so it's sent normally.

/** Raw HTML (no JavaScript run): returns 'reCAPTCHA', 'reCAPTCHA (invisible)', 'hCaptcha', 'Turnstile', 'Friendly Captcha' or null. */
export function captchaFromHtml(html) {
  if (/challenges\.cloudflare\.com\/turnstile|cf-turnstile/i.test(html)) return 'Turnstile';
  if (/hcaptcha\.com|h-captcha/i.test(html)) return /data-size=["']invisible/i.test(html) && !/class=["'][^"']*h-captcha(?![^>]*invisible)/i.test(html) ? 'hCaptcha (invisible)' : 'hCaptcha';
  if (/friendlycaptcha|frc-captcha/i.test(html)) return 'Friendly Captcha';
  if (!/recaptcha\/(api|enterprise)\.js|g-recaptcha|grecaptcha|recaptcha_public_key|www\.google\.com\/recaptcha/i.test(html)) return null;
  const widgets = html.match(/<[^>]+class=["'][^"']*\bg-recaptcha\b[^>]*>/gi) || [];
  const visibleWidget = widgets.some(w => !/data-size=["']invisible/i.test(w) && !/data-badge=/i.test(w));
  const v3 = /recaptcha\/(api|enterprise)\.js\?[^"'>]*render=(?!explicit)[\w-]{20,}/i.test(html) || /grecaptcha\.(enterprise\.)?execute/i.test(html) || /wpcf7[-_]?recaptcha/i.test(html) || /data-size=["']invisible/i.test(html) || /grecaptcha-badge/i.test(html);
  return !visibleWidget && v3 ? 'reCAPTCHA (invisible)' : 'reCAPTCHA';
}
export const isInvisible = (c) => /invisible/i.test(c || '');

/** Runs inside a page (pass to page.evaluate). Looks at what is actually rendered. */
export function captchaInPage() {
  const shown = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width >= 150 && r.height >= 50 && s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05; };
  const scripts = [...document.scripts].map(s => s.src).join(' ');
  const type = (t) => /hcaptcha/i.test(t) ? 'hCaptcha' : /turnstile|challenges\.cloudflare/i.test(t) ? 'Turnstile' : /friendly|frc-/i.test(t) ? 'Friendly Captcha' : 'reCAPTCHA';
  const cands = document.querySelectorAll('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare.com"],.g-recaptcha,.h-captcha,.cf-turnstile,.frc-captcha,[data-sitekey]');
  let any = null;
  for (const el of cands) {
    const sig = (el.src || '') + ' ' + (el.className || '') + ' ' + el.outerHTML.slice(0, 200);
    any = any || type(sig);
    if (el.closest('.grecaptcha-badge') || /size=invisible/.test(el.src || '') || el.getAttribute('data-size') === 'invisible' || el.getAttribute('data-badge')) continue;
    if (/cf-turnstile|challenges\.cloudflare|frc-captcha/.test(sig) && el.getBoundingClientRect().height >= 40) return { kind: 'visible', type: type(sig) };
    if (shown(el)) return { kind: 'visible', type: type(sig) };
  }
  if (any || /recaptcha|hcaptcha|turnstile/i.test(scripts) || document.querySelector('.grecaptcha-badge')) return { kind: 'invisible', type: `${any || type(scripts)} (invisible)` };
  return { kind: null, type: null };
}

/** Frames that can't hold the business's contact form: skip them (asking a frame that never loads can hang forever). */
const SKIP_FRAME = /^about:|^data:|^chrome|recaptcha|hcaptcha|challenges\.cloudflare|doubleclick|googlesyndication|googletagmanager|google\.com\/maps|maps\.google|youtube|vimeo|facebook\.com\/plugins|twitter\.com|instagram|tiktok|intercom|drift|tawk|livechat|zendesk|hotjar/i;
export const usableFrames = (page) => [page.mainFrame(), ...page.frames().filter(f => f !== page.mainFrame() && !f.isDetached() && !SKIP_FRAME.test(f.url() || 'about:'))];
/** frame.evaluate with a time limit. */
export function evalIn(frame, fn, arg, ms = 3000) {
  let t;
  return Promise.race([frame.evaluate(fn, arg), new Promise((_, rej) => { t = setTimeout(() => rej(new Error('frame timeout')), ms); })]).finally(() => clearTimeout(t));
}
