// Does the website check (what "Has a form" relies on) agree with what the robot can actually do? Runs every fixture.
import { startServer } from './server.mjs';
import { FIXTURES } from './fixtures.mjs';
import { checkSite, FORM, SITE } from '../../runner/check.mjs';
import { browserFormCheck, closeBrowser } from '../../runner/browser.mjs';

const { close } = await startServer(8899);
const LABEL = ['open', 'captcha', 'none', 'not checked', 'needs browser'];
// What the robot can do on each fixture: send (open), stop for a CAPTCHA (captcha) or find nothing usable (none).
const truth = (fx) => fx.id === 'contact-subpage' ? 'open' : fx.expect === 'manual' ? (fx.id === 'portal-login' ? 'none' : 'captcha') : fx.expect === 'noform' ? 'none' : 'open';
let agree = 0; const bad = [];
for (const fx of FIXTURES) {
  const url = `http://localhost:8899/f/${fx.id}`;
  const r = await checkSite(url, { form: true, email: false });
  if ([FORM.NEEDS_BROWSER, FORM.OPEN, FORM.CAPTCHA].includes(r.form) || (r.form === FORM.NONE && (r.site === SITE.LOADS || r.site === SITE.SLOW))) {
    const b = await browserFormCheck(r.form_url || url);
    if (b.form !== FORM.NEEDS_BROWSER) Object.assign(r, b);
  }
  const got = LABEL[r.form], want = truth(fx);
  if (got === want) agree++; else bad.push(`${fx.id}: check says ${got}, robot can do ${want}`);
}
await closeBrowser(); close();
console.log(bad.join('\n'));
console.log(`\nWebsite check agrees with the robot on ${agree}/${FIXTURES.length} fixtures`);
process.exit(bad.length ? 1 : 0);
