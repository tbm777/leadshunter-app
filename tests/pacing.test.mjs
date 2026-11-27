// Simulated days: the scheduler ticks every 10 minutes and each batch is sent at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { paceAllowance, rampCap, allowedNow, BATCH } from '../src/pacing.js';

function simulateDay({ limit, startH, endH, pauseFrom = null, pauseTo = null }) {
  let sent = 0;
  const byHour = {};
  for (let m = 0; m < 24 * 60; m += 10) {
    const nowH = m / 60;
    if (pauseFrom != null && nowH >= pauseFrom && nowH < pauseTo) continue;
    const n = paceAllowance({ limit, sent, startH, endH, nowH });
    if (n) { sent += n; byHour[Math.floor(nowH)] = (byHour[Math.floor(nowH)] || 0) + n; }
  }
  return { sent, byHour };
}

test('1,000 a day over 9am-5pm: all sent, spread evenly, never a burst', () => {
  const { sent, byHour } = simulateDay({ limit: 1000, startH: 9, endH: 17 });
  assert.equal(sent, 1000);
  const hours = Object.keys(byHour).map(Number);
  assert.deepEqual(hours, [9, 10, 11, 12, 13, 14, 15, 16]);
  for (const h of hours) assert.ok(byHour[h] >= 115 && byHour[h] <= 135, `hour ${h}: ${byHour[h]}`);
});

test('100 a day: batches of at least 5, all sent by the end of the window', () => {
  let sent = 0, batches = [];
  for (let m = 0; m < 24 * 60; m += 10) {
    const n = paceAllowance({ limit: 100, sent, startH: 9, endH: 17, nowH: m / 60 });
    if (n) { batches.push(n); sent += n; }
  }
  assert.equal(sent, 100);
  assert.ok(batches.every(b => b >= 5), batches.join(','));
  assert.ok(batches.length >= 15 && batches.length <= 20, `${batches.length} batches`);
});

test('nothing outside the window', () => {
  for (const nowH of [0, 8.9, 17, 23.5]) assert.equal(paceAllowance({ limit: 1000, sent: 0, startH: 9, endH: 17, nowH }), 0);
});

test('after a 2-hour pause it catches up in capped batches, not one burst', () => {
  const { sent, byHour } = simulateDay({ limit: 1000, startH: 9, endH: 17, pauseFrom: 11, pauseTo: 13 });
  assert.equal(sent, 1000);
  assert.ok(byHour[13] <= 6 * BATCH, `hour 13: ${byHour[13]}`);
});

test('a short window still finishes', () => {
  const { sent } = simulateDay({ limit: 300, startH: 10, endH: 12 });
  assert.equal(sent, 300);
});

test('warm-up for a new sender profile', () => {
  assert.equal(rampCap(null), 100);
  assert.equal(rampCap(3), 100);
  assert.equal(rampCap(10), 250);
  assert.equal(rampCap(20), 500);
  assert.equal(rampCap(27), 750);
  assert.equal(rampCap(28), Infinity);
});

test('the tightest limit wins', () => {
  assert.equal(allowedNow({ pace: 21, campaignLeft: 500, senderLeft: 8, toolLeft: 900 }), 8);
  assert.equal(allowedNow({ pace: 21, campaignLeft: 500, senderLeft: 100, toolLeft: 0 }), 0);
});
