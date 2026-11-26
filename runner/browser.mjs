// Real-browser form check for sites that build their form with JavaScript (Wix, Squarespace, embeds…).
// Playwright is installed on demand the first time it is needed, so plain searches stay fast.
import { execSync } from 'node:child_process';
import { FORM } from './check.mjs';

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      let pw;
      try { pw = await import('playwright'); } catch {
        console.log('Installing Playwright for browser checks…');
        execSync('npm install --no-save --silent playwright@1.48.2', { cwd: new URL('.', import.meta.url).pathname, stdio: 'inherit' });
        execSync('npx playwright install --with-deps chromium', { cwd: new URL('.', import.meta.url).pathname, stdio: 'inherit' });
        pw = await import('playwright');
      }
      try { return await pw.chromium.launch({ args: ['--no-sandbox'] }); }
      catch {
        // Cached install but missing browser or system libraries: install them once, then retry.
        console.log('Installing the browser for Playwright…');
        execSync('npx playwright install --with-deps chromium', { cwd: new URL('.', import.meta.url).pathname, stdio: 'inherit' });
        return pw.chromium.launch({ args: ['--no-sandbox'] });
      }
    })();
  }
  return browserPromise;
}

const CAPTCHA_SEL = 'iframe[src*="recaptcha"], .g-recaptcha, iframe[src*="hcaptcha"], .h-captcha, iframe[src*="challenges.cloudflare.com"], .cf-turnstile';

/** Returns { form, captcha, form_url } using a real browser. */
export async function browserFormCheck(url) {
  const browser = await getBrowser();
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', viewport: { width: 1280, height: 900 } });
  await ctx.route('**/*', route => {
    const t = route.request().resourceType();
    return ['image', 'media', 'font'].includes(t) ? route.abort() : route.continue();
  });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    // Look in the page and in every frame (embedded form builders render inside iframes).
    for (const frame of page.frames()) {
      const found = await frame.evaluate(() => {
        const forms = [...document.querySelectorAll('form')];
        const ok = forms.some(f => f.querySelector('textarea') && f.querySelector('input[type=email], input[name*=mail i], input[type=tel], input[name*=phone i]'));
        if (ok) return true;
        // Some builders skip <form>: a textarea plus an email field on the page is enough.
        return !!(document.querySelector('textarea') && document.querySelector('input[type=email], input[name*=mail i]'));
      }).catch(() => false);
      if (found) {
        const cap = await page.$(CAPTCHA_SEL);
        let captcha = null;
        if (cap) {
          const html = await cap.evaluate(el => el.outerHTML);
          captcha = /hcaptcha/i.test(html) ? 'hCaptcha' : /cloudflare|turnstile/i.test(html) ? 'Turnstile' : 'reCAPTCHA';
        } else {
          const scripts = await page.$$eval('script[src]', s => s.map(x => x.src).join(' '));
          if (/recaptcha/i.test(scripts)) captcha = 'reCAPTCHA';
          else if (/hcaptcha/i.test(scripts)) captcha = 'hCaptcha';
          else if (/turnstile/i.test(scripts)) captcha = 'Turnstile';
        }
        return { form: captcha ? FORM.CAPTCHA : FORM.OPEN, captcha, form_url: page.url() };
      }
    }
    return { form: FORM.NONE, captcha: null, form_url: null };
  } catch {
    return { form: FORM.NEEDS_BROWSER, captcha: null, form_url: url };
  } finally {
    await ctx.close().catch(() => {});
  }
}

export async function closeBrowser() {
  if (browserPromise) { try { (await browserPromise).close(); } catch { /* ignore */ } }
}
