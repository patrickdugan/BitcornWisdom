import test from 'node:test';
import assert from 'node:assert/strict';
import { viewRange, coordinateMap, createPriceScale } from '../src/chart.js';
import { streamUrl, checkMarket } from '../src/binance.js';
import { heatColor } from '../src/heatmap.js';
import { makeDemoCandles, makeDemoDepth } from '../src/demo.js';

test('time-index x coordinates invert at fractional positions after pan and zoom', () => {
  for (const step of [2, 4, 8, 24, 45]) {
    for (const offset of [-300, -30, 0, 20, 50]) {
      const model = coordinateMap({ length: 900, plotRight: 800, barWidth: step, offsetBars: offset });
      for (const i of [0, 20.5, 300, 700.75, 899]) {
        assert.ok(Math.abs(model.index(model.x(i)) - i) < 1e-9);
      }
    }
  }
});

test('linear and logarithmic price scales are invertible', () => {
  for (const log of [false, true]) {
    const scale = createPriceScale(100, 10000, 20, 520, log);
    for (const price of [100, 150, 1500, 8000, 10000]) {
      assert.ok(Math.abs(scale.price(scale.y(price)) / price - 1) < 1e-12);
    }
    assert.ok(scale.y(10000) < scale.y(100));
  }
});

test('viewport stays bounded at normal offsets', () => {
  const { start, end } = viewRange(900, 800, 8, 0);
  assert.ok(start >= 0 && end < 900 && start < end);
});

test('market endpoint validation avoids URL injection', () => {
  assert.match(streamUrl('spot', 'BTCUSDT', '5m'), /btcusdt@kline_5m/);
  assert.match(streamUrl('futures', 'BTCUSDT', '1m'), /fstream.binance.com/);
  assert.throws(() => checkMarket('spot', 'BTC/USDT', '5m'), RangeError);
  assert.throws(() => checkMarket('spot', 'BTCUSDT', '1x'), RangeError);
});

test('heatmap color indices are clamped and stable', () => {
  assert.equal(heatColor(-1), heatColor(0));
  assert.equal(heatColor(5), heatColor(1));
  assert.notEqual(heatColor(0), heatColor(1));
});

test('demo data is deterministic and book is ordered', () => {
  assert.deepEqual(makeDemoCandles('1m', 50, 1700000000000),
    makeDemoCandles('1m', 50, 1700000000000));
  const data = makeDemoCandles('1m', 10, 1700000000000);
  assert.ok(data.every((c) => c.high >= c.open && c.high >= c.close &&
    c.low <= c.open && c.low <= c.close));
  const book = makeDemoDepth(data.at(-1).close, 1700000000000);
  assert.equal(book.bids.length, 20);
  assert.ok(book.bids[0][0] > book.bids[1][0]);
  assert.ok(book.asks[0][0] < book.asks[1][0]);
});
