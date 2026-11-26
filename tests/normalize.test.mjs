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

import { parseAddress, prettyPhone } from '../public/shared/normalize.js';
test('one-line addresses split into city, region and postal code', () => {
  assert.deepEqual(parseAddress('123 Main St, Brooklyn, NY 11201', 'US'), { city: 'Brooklyn', region: 'NY', postal: '11201' });
  assert.deepEqual(parseAddress('55 Water St, New York, NY 10041, United States', 'US'), { city: 'New York', region: 'NY', postal: '10041' });
  assert.deepEqual(parseAddress('100 Queen St W, Toronto, ON M5H 2N2', 'CA'), { city: 'Toronto', region: 'ON', postal: 'M5H 2N2' });
  assert.deepEqual(parseAddress('1 George St, Sydney NSW 2000', 'AU'), { city: 'Sydney', region: 'NSW', postal: '2000' });
  assert.deepEqual(parseAddress('Shop 4 - Al Quoz - Dubai - United Arab Emirates', 'AE'), { city: 'Dubai', region: 'Dubai', postal: null });
  assert.deepEqual(parseAddress('', 'US'), { city: null, region: null, postal: null });
});
test('phones are made readable', () => {
  assert.equal(prettyPhone('(973)538-3910'), '(973) 538-3910');
  assert.equal(prettyPhone('+12125550101'), '+1 (212) 555-0101');
  assert.equal(prettyPhone('04 123 4567'), '04 123 4567');
});
