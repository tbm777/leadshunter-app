import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanWebsite, domainOf, isSharedDomain, phoneE164, countryCode, categoryAccepted, isSocialHost } from '../public/shared/normalize.js';

test('websites are cleaned', () => {
  assert.equal(cleanWebsite('example.com'), 'https://example.com/');
  assert.equal(cleanWebsite('/url?q=https%3A%2F%2Facme-roofing.com%2F%3Futm_source%3Dgmb%26page%3D2'), 'https://acme-roofing.com/?page=2');
  assert.equal(cleanWebsite('not a url'), null);
  assert.equal(cleanWebsite(''), null);
});
test('domains ignore www and shared hosts are flagged', () => {
  assert.equal(domainOf('https://www.Acme.com/contact'), 'acme.com');
  assert.ok(isSharedDomain('facebook.com'));
  assert.ok(isSharedDomain('joes.wixsite.com'));
  assert.ok(!isSharedDomain('acme.com'));
  assert.ok(isSocialHost('www.facebook.com'));
});
test('phones normalise to E.164', () => {
  assert.equal(phoneE164('(512) 555-0148', 'US'), '+15125550148');
  assert.equal(phoneE164('+1 512-555-0148', 'US'), '+15125550148');
  assert.equal(phoneE164('(02) 9123 4567', 'AU'), '+61291234567');
  assert.equal(phoneE164('0412 345 678', 'AU'), '+61412345678');
  assert.equal(phoneE164('+61 412 345 678', 'AU'), '+61412345678');
  assert.equal(phoneE164('04 123 4567', 'AE'), '+97141234567');
  assert.equal(phoneE164('050 123 4567', 'AE'), '+971501234567');
  assert.equal(phoneE164('416 555 0199', 'CA'), '+14165550199');
  assert.equal(phoneE164('123', 'US'), null);
});
test('countries and categories', () => {
  assert.equal(countryCode('United States'), 'US');
  assert.equal(countryCode('Australia'), 'AU');
  assert.equal(countryCode('United Arab Emirates'), 'AE');
  assert.equal(countryCode('', 'CA'), 'CA');
  assert.ok(categoryAccepted([], 'Anything'));
  assert.ok(categoryAccepted(['Roofing contractor'], 'roofing contractor'));
  assert.ok(categoryAccepted(['Roofer'], 'Construction company', ['Roofer']));
  assert.ok(!categoryAccepted(['Roofing contractor'], 'Hardware store', ['Home improvement store']));
});
