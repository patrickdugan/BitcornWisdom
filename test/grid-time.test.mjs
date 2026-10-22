import test from 'node:test';
import assert from 'node:assert/strict';
import { timeAtIndex, indexAtTime, getUTCViewport, applyUTCViewport } from '../src/grid-time.js';

const minute = 60_000;
function rows(intervalMs, count, ending = Date.UTC(2026, 9, 22, 12)) {
  return Array.from({ length: count }, (_, i) => ({
    time: ending - (count - i - 1) * intervalMs
  }));
}
function chart(interval, candles, barWidth = 8, offsetBars = 0) {
  return { interval, candles, barWidth, offsetBars, width: 1000, gap: 11,
    drawCount: 0, requestDraw() { this.drawCount++; } };
}
test('fractional indices round-trip in UTC including future and historical extrapolation', () => {
  const candles = rows(5 * minute, 30);
  for (const index of [-9.5, 0, 1.25, 17.75, 29, 42.25]) {
    const time = timeAtIndex(candles, index, '5m');
    assert.ok(Math.abs(indexAtTime(candles, time, '5m') - index) < 1e-8);
  }
  assert.equal(indexAtTime([], 123, '1m'), null);
  assert.equal(timeAtIndex([], 5, '1m'), null);
});
test('UTC sync aligns visible start and end with mixed candle intervals', () => {
  const source = chart('1m', rows(minute, 500));
  const target = chart('5m', rows(5 * minute, 100));
  const desired = getUTCViewport(source);
  assert.ok(applyUTCViewport(target, desired));
  const actual = getUTCViewport(target);
  assert.ok(Math.abs(actual.start - desired.start) < 2);
  assert.ok(Math.abs(actual.end - desired.end) < 2);
  assert.equal(target.drawCount, 1);
  assert.ok(target.barWidth > source.barWidth);
});
test('UTC sync centers at the requested instant when zoom clamps', () => {
  const source = chart('1m', rows(minute, 900), 45);
  const target = chart('1h', rows(60 * minute, 300));
  const desired = getUTCViewport(source);
  assert.ok(applyUTCViewport(target, desired));
  assert.equal(target.barWidth, 45);
  const actual = getUTCViewport(target);
  assert.ok(Math.abs((actual.start + actual.end - desired.start - desired.end) / 2) < 2);
});
test('gapped historical time samples interpolate without inventing regular bars', () => {
  const base = Date.UTC(2026, 0, 1);
  const candles = [0, 5, 10, 35, 40].map((m) => ({ time: base + m * minute }));
  assert.equal(timeAtIndex(candles, 2.5, '5m'), base + 22.5 * minute);
  assert.equal(indexAtTime(candles, base + 22.5 * minute, '5m'), 2.5);
});
test('missing data, disjoint history and invalid window cannot change target', () => {
  const target = chart('5m', rows(5 * minute, 40));
  const old = { barWidth: target.barWidth, offsetBars: target.offsetBars };
  assert.equal(applyUTCViewport(target, { start: 0, end: 1 }), false);
  assert.equal(applyUTCViewport(target, { start: 2, end: 1 }), false);
  assert.equal(applyUTCViewport(target, null), false);
  assert.deepEqual({ barWidth: target.barWidth, offsetBars: target.offsetBars }, old);
  assert.equal(getUTCViewport(chart('1m', [])), null);
});
