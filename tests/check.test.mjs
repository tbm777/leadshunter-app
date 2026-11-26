import test from 'node:test';
import assert from 'node:assert/strict';
import { detectForm, detectCaptcha, detectPlatform, contactLinks, findEmail } from '../runner/check.mjs';

const contact = `<form action="/send" method="post"><input name="your-name"><input type="email" name="your-email"><textarea name="your-message"></textarea><button>Send</button></form>`;
test('finds a plain contact form and ignores search forms', () => {
  assert.equal(detectForm(contact).found, true);
  assert.equal(detectForm('<form role="search"><input name="s"></form>').found, false);
  assert.equal(detectForm('<form class="newsletter"><input type="email" name="email"></form>').found, false);
});
test('detects CAPTCHA types', () => {
  assert.equal(detectCaptcha('<script src="https://www.google.com/recaptcha/api.js"></script>'), 'reCAPTCHA');
  assert.equal(detectCaptcha('<div class="h-captcha"></div>'), 'hCaptcha');
  assert.equal(detectCaptcha('<div class="cf-turnstile"></div>'), 'Turnstile');
  assert.equal(detectCaptcha('<p>hello</p>'), null);
  assert.equal(detectForm(contact + '<div class="g-recaptcha"></div>').captcha, 'reCAPTCHA');
});
test('detects embedded form builders and platforms', () => {
  assert.equal(detectForm('<script src="https://js.hsforms.net/forms/v2.js"></script>').embed, true);
  assert.equal(detectPlatform('<link href="/wp-content/themes/x.css">'), 'WordPress');
  assert.equal(detectPlatform('<img src="https://static.wixstatic.com/a.png">'), 'Wix');
  assert.equal(detectPlatform('<p>plain</p>'), 'Custom');
});
test('finds contact links on the same site only', () => {
  const html = '<a href="/contact-us">Contact</a><a href="https://other.com/contact">x</a><a href="/about">About</a><a href="/services">Get a free quote</a>';
  const links = contactLinks(html, 'https://acme.com/');
  assert.deepEqual(links, ['https://acme.com/contact-us', 'https://acme.com/services']);
});
test('prefers the business email over junk', () => {
  assert.equal(findEmail('<a href="mailto:info@acme.com">x</a> user@example.com', 'acme.com'), 'info@acme.com');
  assert.equal(findEmail('logo@2x.png sentry@wixpress.com', 'acme.com'), null);
});
