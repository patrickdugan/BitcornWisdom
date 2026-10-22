import test from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, rsi } from '../src/indicators.js';
const series = [1, 2, 3, 4, 5, 6].map((close) => ({ close }));

test('SMA aligns with original candle indices', () => {
  assert.deepEqual(sma(series, 3), [null, null, 2, 3, 4, 5]);
});

test('EMA seeds with the first SMA and updates recursively', () => {
  assert.deepEqual(ema(series, 3), [null, null, 2, 3, 4, 5]);
  assert.deepEqual(ema(series.slice(0, 2), 3), [null, null]);
});

test('RSI handles monotonic and flat history', () => {
  assert.equal(rsi(series, 3)[3], 100);
  assert.equal(rsi([...series].reverse(), 3)[3], 0);
  assert.equal(rsi(Array(8).fill(0).map(() => ({ close: 10 })), 3)[3], 50);
});

test('invalid indicator periods are rejected', () => {
  assert.throws(() => sma(series, 0), RangeError);
  assert.throws(() => ema(series, -2), RangeError);
  assert.throws(() => rsi(series, 1.5), RangeError);
});
