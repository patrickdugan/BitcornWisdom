import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseKline, parseKlineEvent, normalizeDepth, parseTrade, upsertCandle, formatPrice
} from '../src/core.js';

const row = (time, close) => [time, String(close - 1), String(close + 2),
  String(close - 2), String(close), '10'];

test('REST and realtime kline share the same candle model', () => {
  const rest = parseKline(row(60000, 101));
  const event = parseKlineEvent({ k: {
    t: 60000, o: '100', h: '103', l: '99', c: '101', v: '10'
  } });
  assert.deepEqual(rest, event);
  assert.equal(rest.time, 60000);
});

test('reject inverted and nonnumeric candle values', () => {
  assert.throws(() => parseKline([1, '3', '2', '1', '2', '8']));
  assert.throws(() => parseKline([1, 'x', '2', '1', '2', '8']));
});

test('upsert replaces live bar, inserts new bars and reorders delayed bars', () => {
  const candles = [parseKline(row(0, 100)), parseKline(row(120000, 104))];
  assert.equal(upsertCandle(candles, parseKline(row(120000, 105))), 'replaced');
  assert.equal(candles.length, 2);
  assert.equal(upsertCandle(candles, parseKline(row(60000, 102))), 'inserted');
  assert.deepEqual(candles.map((v) => v.time), [0, 60000, 120000]);
  assert.equal(upsertCandle(candles, parseKline(row(180000, 106)), 3), 'inserted');
  assert.deepEqual(candles.map((v) => v.time), [60000, 120000, 180000]);
  assert.equal(upsertCandle(candles, parseKline(row(0, 100)), 3), 'ignored');
});

test('partial depth rows are sorted and quantities are numeric', () => {
  const book = normalizeDepth({ lastUpdateId: 55,
    bids: [['100', '2'], ['101', '1'], ['99', '0']],
    asks: [['104', '1'], ['103', '4']] });
  assert.deepEqual(book.bids, [[101, 1], [100, 2]]);
  assert.deepEqual(book.asks, [[103, 4], [104, 1]]);
  assert.equal(book.lastUpdateId, 55);
});

test('trade aggressor interpretation respects buyer-maker flag', () => {
  const sample = { e: 'trade', p: '100.12', q: '0.2', T: 12000, m: true, t: 4 };
  assert.equal(parseTrade(sample).side, 'sell');
  assert.equal(parseTrade({ ...sample, m: false }).side, 'buy');
});

test('price formatter handles large, tiny, and invalid numbers', () => {
  assert.equal(formatPrice(12000.123), '12,000.12');
  assert.match(formatPrice(0.000123456), /0.00012346/);
  assert.equal(formatPrice(NaN), '—');
});
