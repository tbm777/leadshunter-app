import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMessage } from '../public/shared/msgcheck.js';

const good = { subject: 'Quick idea for [Company Name]', message: "Hi [Company Name] team,\n\nMost homeowners who reach voicemail call the next contractor. We set up instant text-back so you keep those jobs.\n\nNot a fit? Reply 'no' and I won't reach out again.\n\nBest,\nAlfred" };
test('a plain, personal message passes', () => assert.deepEqual(checkMessage(good), []));
test('flags several links and shorteners', () => {
  const r = checkMessage({ subject: 'Hi', message: good.message + ' https://a.com https://b.com https://bit.ly/x' });
  assert.ok(r.some(x => /3 links|4 links/.test(x.text)));
  assert.ok(r.some(x => /shortener/.test(x.text)));
});
test('flags unknown merge tags, spam phrases and shouting', () => {
  const r = checkMessage({ subject: 'ACT NOW!!!', message: "Hi [Owner Name], this is 100% FREE and GUARANTEED. Not a fit? Reply 'no'." });
  assert.ok(r.some(x => /\[Owner Name\]/.test(x.text)));
  assert.ok(r.some(x => /spam phrase/.test(x.text)));
  assert.ok(r.some(x => /capitals|exclamation/.test(x.text)));
});
test('suggests a way out when there is none', () => {
  const r = checkMessage({ subject: 'Hi', message: 'Hi [Company Name] team, we help contractors get more calls from Google every month.' });
  assert.ok(r.some(x => x.level === 'tip' && /way out/.test(x.text)));
});
test('flags very long messages', () => assert.ok(checkMessage({ subject: 'x', message: 'word '.repeat(300) + "Reply 'no'" }).some(x => /characters/.test(x.text))));
