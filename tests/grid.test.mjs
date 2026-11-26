import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCells, cityRadiusKm, pointsForCircle, splitCell } from '../public/shared/grid.js';

test('city radius grows with population and stays in bounds', () => {
  assert.equal(cityRadiusKm(0), 3);
  assert.ok(cityRadiusKm(1_000_000) > 10 && cityRadiusKm(1_000_000) < 14);
  assert.equal(cityRadiusKm(50_000_000), 25);
});
test('points cover the circle and stay near it', () => {
  const pts = pointsForCircle(30.27, -97.74, 12);
  assert.ok(pts.length > 20 && pts.length < 120);
  for (const [lat, lon] of pts) assert.ok(Math.hypot((lat - 30.27) * 111, (lon + 97.74) * 111 * Math.cos(30.27 * Math.PI / 180)) < 16);
});
test('cells repeat per term and merge overlapping circles', () => {
  const one = buildCells([{ lat: 30.27, lon: -97.74, r: 10, country: 'US' }], 1);
  const two = buildCells([{ lat: 30.27, lon: -97.74, r: 10, country: 'US' }, { lat: 30.27, lon: -97.74, r: 10, country: 'US' }], 1);
  assert.equal(one.length, two.length);
  assert.equal(buildCells([{ lat: 30.27, lon: -97.74, r: 10, country: 'US' }], 3).length, one.length * 3);
  const c = one[0];
  assert.equal(c.length, 6); assert.equal(c[5], 'US'); assert.ok(c[2] > 1000 && c[3] >= 13);
});
test('splitting a cell makes four smaller ones', () => {
  const kids = splitCell([30, -97, 3000, 14, 0, 'US']);
  assert.equal(kids.length, 4);
  for (const k of kids) { assert.equal(k[2], 1500); assert.equal(k[3], 15); assert.equal(k[5], 'US'); }
});
