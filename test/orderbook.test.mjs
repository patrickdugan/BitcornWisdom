import test from 'node:test';
import assert from 'node:assert/strict';
import { SequencedOrderBook, parseDepthDelta, parseDepthSnapshot } from '../src/orderbook.js';
import { depthStreamUrl, streamUrl, fetchDepthSnapshot } from '../src/binance.js';
import { binBookLevels } from '../src/heatmap.js';

const snapshot = (id = 10) => ({
  lastUpdateId: id,
  bids: [['100', '3'], ['99', '2']],
  asks: [['101', '4'], ['102', '2']]
});
const update = (U, u, b = [], a = [], pu) => ({
  e: 'depthUpdate', U, u, b, a, ...(pu === undefined ? {} : { pu })
});

test('spot buffers before snapshot, bridges, updates absolute sizes and deletes zeroes', () => {
  const emitted = [];
  const book = new SequencedOrderBook('spot', { onBook: (v) => emitted.push(v) });
  assert.equal(book.ingest(update(9, 12, [['100', '5']], [['101', '0']])), 'buffered');
  assert.equal(book.installSnapshot(snapshot()), 'live');
  assert.equal(book.lastUpdateId, 12);
  assert.deepEqual(emitted.at(-1).bids[0], [100, 5]);
  assert.deepEqual(emitted.at(-1).asks[0], [102, 2]);
  assert.equal(book.ingest(update(13, 13, [['100', '0']], [['103', '8']])), 'applied');
  assert.deepEqual(book.snapshot().bids[0], [99, 2]);
  assert.deepEqual(book.snapshot().asks, [[102, 2], [103, 8]]);
  assert.equal(book.ingest(update(13, 13)), 'stale');
});

test('spot sequence gaps trigger clean resync', () => {
  const errors = [];
  const book = new SequencedOrderBook('spot', { onResync: (v) => errors.push(v) });
  book.ingest(update(10, 11));
  assert.equal(book.installSnapshot(snapshot()), 'live');
  assert.equal(book.ingest(update(21, 22)), 'resync');
  assert.equal(book.phase, 'buffering');
  assert.equal(book.lastUpdateId, null);
  assert.equal(book.snapshot().bids.length, 0);
  assert.match(errors.at(-1), /missing|out-of-order/);
});

test('stale snapshot is rejected without adopting a false book', () => {
  const book = new SequencedOrderBook();
  book.ingest(update(30, 35));
  assert.equal(book.installSnapshot(snapshot(20)), 'retry');
  assert.equal(book.phase, 'buffering');
  assert.equal(book.buffer.length, 1);
  assert.equal(book.installSnapshot(snapshot(31)), 'live');
});

test('futures validates pu continuity after first overlapping event', () => {
  const book = new SequencedOrderBook('futures');
  book.ingest(update(70, 75, [['100', '5']], [], 69));
  assert.equal(book.installSnapshot(snapshot(72)), 'live');
  assert.equal(book.ingest(update(76, 78, [], [['102', '3']], 75)), 'applied');
  assert.equal(book.ingest(update(79, 81, [], [], 70)), 'resync');
  assert.equal(book.phase, 'buffering');
});

test('bridge waits for fresh depth after an empty buffer', () => {
  const book = new SequencedOrderBook();
  assert.equal(book.installSnapshot(snapshot()), 'bridging');
  assert.equal(book.ingest(update(11, 11)), 'applied');
  assert.equal(book.phase, 'live');
});

test('validation rejects malformed, crossing and unbounded depth payloads', () => {
  assert.throws(() => parseDepthDelta(update(9, 8)), TypeError);
  assert.throws(() => parseDepthDelta(update(9, 10, [['100', '-3']])), TypeError);
  assert.throws(() => parseDepthSnapshot({ lastUpdateId: 'NaN', bids: [], asks: [] }), TypeError);
  const book = new SequencedOrderBook();
  book.ingest(update(10, 11, [['105', '4']]));
  assert.equal(book.installSnapshot(snapshot()), 'resync');
  assert.equal(book.phase, 'buffering');
});

test('Binance 2026 routed feeds separate market and public diff-depth', () => {
  assert.match(streamUrl('futures', 'BTCUSDT', '5m'), /\/market\/stream\?/);
  assert.doesNotMatch(streamUrl('futures', 'BTCUSDT', '5m'), /@depth/);
  assert.match(depthStreamUrl('futures', 'BTCUSDT'), /\/public\/ws\/btcusdt@depth@100ms/);
  assert.match(depthStreamUrl('spot', 'BTCUSDT'), /data-stream.binance.vision\/ws/);
});

test('depth REST fetch respects snapshot limits and supplied transport', async () => {
  const calls = [];
  const result = await fetchDepthSnapshot('spot', 'BTCUSDT', undefined, 1000, async (url) => {
    calls.push(url);
    return { ok: true, json: async () => snapshot() };
  });
  assert.equal(result.lastUpdateId, 10);
  assert.match(calls[0], /limit=1000/);
});

test('liquidity bins bound full-depth memory and aggregate same-bin notional', () => {
  const book = { bids: [[100, 2], [100.001, 3]], asks: [[100.5, 4]] };
  const bins = binBookLevels(book, 100, .01, 20);
  assert.ok(bins.length <= 20);
  assert.ok(bins.length >= 2);
  assert.ok(bins.reduce((sum, [,qty]) => sum + qty, 0) > 8);
});
