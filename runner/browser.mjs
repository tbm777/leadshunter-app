// Real-browser form check for sites that build their form with JavaScript (Wix, Squarespace, embeds…).
// Playwright is installed on demand the first time it is needed, so plain searches stay fast.
import { execSync } from 'node:child_process';
import { FORM } from './check.mjs';
import { captchaInPage, usableFrames, evalIn } from './forms/captcha-probe.mjs';

let browserPromise = null;

export async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      let pw;
      try { pw = await import('playwright'); } catch {
        console.log('Installing Playwright for browser checks…');
        execSync('npm install --no-save --silent playwright@1.48.2', { cwd: new URL('.', import.meta.url).pathname, stdio: 'inherit' });
        execSync('npx playwright install --with-deps chromium', { cwd: new URL('.', import.meta.url).pathname, stdio: 'inherit' });
        pw = await import('playwright');
      }
      const executablePath = process.env.CHROMIUM_PATH || undefined; // local testing with a preinstalled browser
      try { return await pw.chromium.launch({ args: ['--no-sandbox'], executablePath }); }
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

// Same rules as the form robot, so the label in Leads matches what happens when sending.
const CAPTCHA_SEL = 'iframe[src*="recaptcha"],.g-recaptcha,iframe[src*="hcaptcha"],.h-captcha,iframe[src*="challenges.cloudflare.com"],.cf-turnstile,[data-sitekey],iframe[src*="friendlycaptcha"],.frc-captcha';

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
    for (const frame of usableFrames(page)) {
      const found = await evalIn(frame, () => {
        const forms = [...document.querySelectorAll('form')];
        const ok = forms.some(f => f.querySelector('textarea') && f.querySelector('input[type=email], input[name*=mail i], input[type=tel], input[name*=phone i]'));
        if (ok) return true;
        // Some builders skip <form>: a textarea plus an email field on the page is enough.
        return !!(document.querySelector('textarea') && document.querySelector('input[type=email], input[name*=mail i]'));
      }).catch(() => false);
      if (found) {
        // Some sites only load their CAPTCHA once you start typing.
        await frame.evaluate(() => { const el = document.querySelector('form textarea, textarea, form input[type=email]'); if (el) { el.focus(); el.dispatchEvent(new Event('focusin', { bubbles: true })); el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' })); } }).catch(() => {});
        await page.waitForTimeout(1500);
        // Visible challenge → CAPTCHA (manual). Invisible score check → open form (a person is never asked anything).
        let probe = { kind: null, type: null };
        for (const fr of [frame, page.mainFrame()]) { const p = await evalIn(fr, captchaInPage).catch(() => null); if (p && p.kind === 'visible') { probe = p; break; } if (p && p.kind) probe = p; }
        return { form: probe.kind === 'visible' ? FORM.CAPTCHA : FORM.OPEN, captcha: probe.type, form_url: page.url() };
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
