import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COINBASE_INTERVALS, coinbaseProduct, checkCoinbase,
  parseCoinbaseHistory, fetchCoinbaseCandles, parseCoinbaseTrade,
  CoinbaseCandleBuilder, CoinbaseBook
} from '../src/coinbase.js';

test('Coinbase products and permitted timeframes are explicit', () => {
  assert.equal(coinbaseProduct('BTCUSD'), 'BTC-USD');
  assert.equal(coinbaseProduct('ETHUSDT'), 'ETH-USDT');
  assert.equal(coinbaseProduct('BTCUSDC'), 'BTC-USDC');
  assert.equal(COINBASE_INTERVALS['6h'], 21600);
  assert.throws(() => coinbaseProduct('BTC-USD'), RangeError);
  assert.throws(() => checkCoinbase('BTCUSD', '3m'), RangeError);
});

test('Coinbase REST candle order normalizes seconds and OHLCV correctly', () => {
  const candles = parseCoinbaseHistory([
    [1710000300, 95, 110, 100, 105, 1.75],
    [1710000000, 90, 109, 95, 100, 2.50]
  ]);
  assert.deepEqual(candles, [
    { time: 1710000000000, open: 95, high: 109, low: 90, close: 100, volume: 2.5 },
    { time: 1710000300000, open: 100, high: 110, low: 95, close: 105, volume: 1.75 }
  ]);
  assert.throws(() => parseCoinbaseHistory({ message: 'bad request' }), TypeError);
});

test('Coinbase latest history request uses the documented granularity and endpoint', async () => {
  let url;
  const candles = await fetchCoinbaseCandles('BTCUSD', '5m', undefined, async (input) => {
    url = input;
    return { ok: true, json: async () => [[1710000000, 90, 109, 95, 100, 2.5]] };
  });
  assert.match(url, /products\/BTC-USD\/candles\?granularity=300/);
  assert.equal(candles.length, 1);
});

test('Coinbase match side represents maker, inverse of tape taker aggression', () => {
  const trade = parseCoinbaseTrade({
    type: 'match', trade_id: 310, price: '81850.30', size: '0.03',
    side: 'sell', time: '2026-10-22T07:01:00Z'
  });
  assert.equal(trade.side, 'buy');
  assert.equal(trade.quantity, .03);
  assert.equal(trade.id, 310);
  assert.throws(() => parseCoinbaseTrade({
    type: 'match', price: 'bad', size: '1', side: 'buy', time: 'invalid'
  }), TypeError);
});

test('Coinbase live trade builder extends current bar, rolls time and ignores replay', () => {
  const builder = new CoinbaseCandleBuilder('5m');
  const t = Date.UTC(2026, 9, 22, 7, 0);
  builder.seed({ time: t, open: 100, high: 102, low: 99, close: 101, volume: 9 });
  const event = (id, time, price, quantity) => ({ id, time, price, quantity });
  assert.deepEqual(builder.ingest(event(1, t + 60_000, 103, 2)), {
    time: t, open: 100, high: 103, low: 99, close: 103, volume: 11
  });
  assert.equal(builder.ingest(event(1, t + 62_000, 103, 2)), null);
  assert.deepEqual(builder.ingest(event(2, t + 300_000, 105, 1)), {
    time: t + 300_000, open: 105, high: 105, low: 105, close: 105, volume: 1
  });
  assert.equal(builder.ingest(event(3, t + 60_000, 10, 1)), null);
});

test('Coinbase L2 snapshots apply changes and absolute zero-size deletes', () => {
  const book = new CoinbaseBook(10);
  assert.equal(book.apply({ type: 'l2update', changes: [['buy','100','4']] }), null);
  const first = book.apply({
    type: 'snapshot', product_id: 'BTC-USD',
    bids: [['100','3'],['99','2']], asks: [['101','4'],['102','1']]
  });
  assert.equal(first.source, 'coinbase-level2');
  assert.deepEqual(first.bids, [[100, 3], [99, 2]]);
  const next = book.apply({
    type: 'l2update', changes: [['buy','100','0'],['buy','99.5','5'],['sell','101','7']]
  });
  assert.deepEqual(next.bids, [[99.5, 5], [99, 2]]);
  assert.deepEqual(next.asks, [[101, 7], [102, 1]]);
});

test('Coinbase L2 rejects crossed/invalid books and bounds storage', () => {
  const book = new CoinbaseBook(10);
  assert.throws(() => book.apply({
    type: 'snapshot', bids: [['102','3']], asks: [['101','3']]
  }), /crossed/);
  assert.equal(book.ready, false);
  const bids = Array.from({ length: 35 }, (_, i) => [String(100 - i), '1']);
  const asks = Array.from({ length: 35 }, (_, i) => [String(101 + i), '1']);
  const snapshot = book.apply({ type: 'snapshot', bids, asks });
  assert.equal(snapshot.bids.length, 10);
  assert.equal(snapshot.asks.length, 10);
  assert.equal(book.bids.size, 10);
  assert.equal(book.asks.size, 10);
  assert.throws(() => book.apply({
    type: 'l2update', changes: [['nonsense','100','2']]
  }), /side/);
});
