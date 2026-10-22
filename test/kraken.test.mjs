import test from 'node:test';
import assert from 'node:assert/strict';
import {
  krakenSymbols, checkKraken, parseKrakenHistory, parseKrakenCandle,
  decodeKrakenMessage, krakenBookChecksum, KrakenBook, KRAKEN_INTERVALS
} from '../src/kraken.js';

test('Kraken spot symbol, interval, and REST history normalization', () => {
  assert.deepEqual(krakenSymbols('BTCUSD'), { wire: 'BTC/USD', rest: 'XBTUSD' });
  assert.deepEqual(krakenSymbols('ETHUSDT'), { wire: 'ETH/USDT', rest: 'ETHUSDT' });
  assert.equal(KRAKEN_INTERVALS['1w'], 10080);
  assert.throws(() => checkKraken('BTCUSD', '3d'), RangeError);
  const candles = parseKrakenHistory({ error: [], result: {
    XXBTZUSD: [[1710000000, '70', '80', '65', '78', '75', '12.5', 28]], last: 1710000000
  } });
  assert.deepEqual(candles[0],
    { time: 1710000000000, open: 70, high: 80, low: 65, close: 78, volume: 12.5 });
  assert.equal(parseKrakenCandle({
    interval_begin: '2026-01-01T00:00:00Z', open: 1, high: 3, low: 1, close: 2, volume: 5
  }).time, Date.UTC(2026, 0, 1));
});

test('numeric Kraken book JSON preserves full decimal precision for CRC', () => {
  const parsed = decodeKrakenMessage('{"channel":"book","data":[{"bids":[{"price":45283.50,"qty":0.10000000}]}]}');
  assert.equal(parsed.data[0].bids[0].price, '45283.50');
  assert.equal(parsed.data[0].bids[0].qty, '0.10000000');
});

// Published Kraken v2 example: checksum 3310070434.
const asks = [
  ['45285.2','0.00100000'],['45286.4','1.54571953'],['45286.6','1.54571109'],
  ['45289.6','1.54560911'],['45290.2','0.15890660'],['45291.8','1.54553491'],
  ['45294.7','0.04454749'],['45296.1','0.35380000'],['45297.5','0.09945542'],
  ['45299.5','0.18772827']
];
const bids = [
  ['45283.5','0.10000000'],['45283.4','1.54582015'],['45282.1','0.10000000'],
  ['45281.0','0.10000000'],['45280.3','1.54592586'],['45279.0','0.07990000'],
  ['45277.6','0.03310103'],['45277.5','0.30000000'],['45277.3','1.54602737'],
  ['45276.6','0.15445238']
];
const objects = (rows) => rows.map(([price,qty]) => ({price,qty}));

test('Kraken CRC matches published official top-ten reference', () => {
  assert.equal(krakenBookChecksum(objects(asks), objects(bids)), 3310070434);
});

test('Kraken book accepts verified snapshot and resets after checksum mismatch', () => {
  const book = new KrakenBook(10);
  const first = book.update({ channel:'book', type:'snapshot', data: [{
    asks: objects(asks), bids: objects(bids), checksum: 3310070434,
    timestamp: '2026-10-22T01:00:00Z'
  }] });
  assert.equal(first.source, 'checksum-verified');
  assert.equal(first.asks.length, 10);
  assert.equal(first.bids.length, 10);
  assert.throws(() => book.update({ channel:'book', type:'update', data: [{
    asks: [{ price: '45285.2', qty: '0.00200000' }],
    bids: [], checksum: 3310070434
  }] }), /checksum mismatch/);
  assert.equal(book.ready, false);
});
