import test from 'node:test';
import assert from 'node:assert/strict';
import { personalize, cleanCompanyName } from '../public/shared/personalize.js';

test('cleans keyword-stuffed Google Maps names', () => {
  assert.equal(cleanCompanyName('Summit Roofing Co. - #1 Roofer in Austin TX | Free Estimates'), 'Summit Roofing Co.');
  assert.equal(cleanCompanyName('ABC Plumbing LLC'), 'ABC Plumbing');
  assert.equal(cleanCompanyName('Smith & Sons, Inc.'), 'Smith & Sons');
  assert.equal(cleanCompanyName('ACME HEATING AND AIR'), 'Acme Heating And Air');
  assert.equal(cleanCompanyName('Joe’s Auto (Downtown)'), 'Joe’s Auto');
  assert.equal(cleanCompanyName('A-1 Pest Control'), 'A-1 Pest Control');
});

test('fills merge tags in every style', () => {
  const lead = { name: 'Summit Roofing LLC', city: 'Austin' };
  assert.equal(personalize('Hi [Company Name] team', lead), 'Hi Summit Roofing team');
  assert.equal(personalize('{{company}} in {city}', lead), 'Summit Roofing in Austin');
  assert.equal(personalize('Missed calls at [company]?', {}), 'Missed calls at your company?');
  assert.equal(personalize('Keep [unknown tag] as is', lead), 'Keep [unknown tag] as is');
});
