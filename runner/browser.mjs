// Real-browser form check for sites that build their form with JavaScript (Wix, Squarespace, embeds…).
// Playwright is installed on demand the first time it is needed, so plain searches stay fast.
import { execSync } from 'node:child_process';
import { FORM } from './check.mjs';
import { shouldBlock } from './lib/block.mjs';
import { contactPages } from './lib/contact.mjs';
import { findFormOnPage } from './forms/filler.mjs';
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

/**
 * Returns { form, captcha, form_url } using a real browser and the robot's own rules: a form counts only if it is visible
 * and fillable (pop-up forms behind a "Get a quote" button included). If the page has none, up to two contact pages are tried.
 */
export async function browserFormCheck(url) {
  const browser = await getBrowser();
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', viewport: { width: 1280, height: 900 } });
  await ctx.route('**/*', route => {
    const t = route.request().resourceType();
    return t === 'image' || shouldBlock(route.request().url(), t) ? route.abort() : route.continue();
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  try {
    const tried = new Set(), queue = [url];
    let loaded = false;
    while (queue.length && tried.size < 3) {
      const u = queue.shift(); if (tried.has(u)) continue; tried.add(u);
      try { await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 20000 }); loaded = true; } catch { continue; }
      const { frame, scan } = await findFormOnPage(page);
      if (scan) {
        // Some sites only load their CAPTCHA once you start typing.
        await frame.evaluate(() => { const el = document.querySelector('form textarea, textarea, form input[type=email]'); if (el) { el.focus(); el.dispatchEvent(new Event('focusin', { bubbles: true })); el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' })); } }).catch(() => {});
        await page.waitForTimeout(1500);
        // Visible challenge → CAPTCHA (manual). Invisible score check → open form (a person is never asked anything).
        let probe = { kind: scan.captcha ? 'visible' : null, type: scan.captchaType || null };
        for (const fr of [frame, page.mainFrame()]) { const p = await evalIn(fr, captchaInPage).catch(() => null); if (p && p.kind === 'visible') { probe = p; break; } if (p && p.kind && !probe.kind) probe = p; }
        return { form: probe.kind === 'visible' ? FORM.CAPTCHA : FORM.OPEN, captcha: probe.type, form_url: page.url() };
      }
      if (tried.size === 1) for (const l of await contactPages(page, page.url())) queue.push(l);
    }
    return loaded ? { form: FORM.NONE, captcha: null, form_url: null } : { form: FORM.NEEDS_BROWSER, captcha: null, form_url: url };
  } catch {
    return { form: FORM.NEEDS_BROWSER, captcha: null, form_url: url };
  } finally {
    await ctx.close().catch(() => {});
  }
}

export async function closeBrowser() {
  if (browserPromise) { try { (await browserPromise).close(); } catch { /* ignore */ } }
}
