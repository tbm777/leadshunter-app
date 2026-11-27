// Dates in Pacific time: daily limits reset at midnight PT, including on daylight-saving days.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ptMidnight } from '../src/worker.js';

const ptClock = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));

for (const [label, iso] of [
  ['an ordinary day', '2026-06-15T20:30:00Z'],
  ['spring forward (Mar 8 2026), after 3am', '2026-03-08T18:00:00Z'],
  ['fall back (Nov 1 2026), after 1am', '2026-11-01T18:00:00Z'],
  ['just after midnight PT', '2026-11-27T08:05:00Z'],
  ['late evening PT', '2026-11-27T07:55:00Z'],
]) {
  test(`midnight Pacific on ${label}`, () => {
    const m = ptMidnight(new Date(iso));
    assert.match(ptClock(m), /, 00:00$/, ptClock(m));
    assert.equal(ptClock(m).slice(0, 10), ptClock(Date.parse(iso)).slice(0, 10));
  });
}

import { addBizDays } from '../src/outreach.js';
const at = (iso) => Date.parse(iso);
test('follow-up 1 business day after a Friday send lands on Monday, same clock time', () => {
  assert.equal(ptClock(addBizDays(at('2026-11-27T17:00:00Z'), 1)), '11/30/2026, 09:00');   // Fri 9:00 PT → Mon 9:00 PT
});
test('across spring forward: a late-evening Friday send keeps its clock time and never skips a day', () => {
  assert.equal(ptClock(addBizDays(at('2026-03-07T07:30:00Z'), 1)), '03/09/2026, 23:30');   // Fri Mar 6 23:30 PST → Mon Mar 9 23:30 PDT
});
test('across fall back: same clock time', () => {
  assert.equal(ptClock(addBizDays(at('2026-10-30T16:00:00Z'), 2)), '11/03/2026, 09:00');   // Fri Oct 30 9:00 PDT → Tue Nov 3 9:00 PST
});
