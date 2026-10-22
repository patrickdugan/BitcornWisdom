import test from 'node:test';
import assert from 'node:assert/strict';
import { CandleChart, coordinateMap } from '../src/chart.js';
import { fetchCandles } from '../src/binance.js';
import { fetchCoinbaseCandles } from '../src/coinbase.js';

const candle = (time, price = 100) => ({
  time, open: price, high: price + 1, low: price - 1, close: price, volume: 1
});

function fakeChart(data, limit = 8000) {
  const chart = Object.create(CandleChart.prototype);
  chart.candles = data.map((c) => ({ ...c }));
  chart.maxCandleBars = limit;
  chart.offsetBars = 123;
  chart.gap = 11;
  chart.barWidth = 8;
  chart.interval = '5m';
  chart.requestDraw = () => {};
  return chart;
}

test('prepending historical bars preserves the horizontal position of existing candles', () => {
  const current = [candle(300000), candle(600000), candle(900000)];
  const older = [candle(0), candle(300000), candle(150000)];
  const chart = fakeChart(current, 6);
  const x0 = coordinateMap({
    length: chart.candles.length, plotRight: 1100,
    barWidth: chart.barWidth, offsetBars: chart.offsetBars, gap: chart.gap
  }).x(1);
  assert.equal(chart.prependHistory(older), 2);
  assert.deepEqual(chart.candles.map((c) => c.time),
    [0, 150000, 300000, 600000, 900000]);
  const x1 = coordinateMap({
    length: chart.candles.length, plotRight: 1100,
    barWidth: chart.barWidth, offsetBars: chart.offsetBars, gap: chart.gap
  }).x(3);
  assert.equal(x0, x1);
  assert.equal(chart.prependHistory(older), 0);
});

test('history prepending obeys bounded chart memory while preserving live bars', () => {
  const chart = fakeChart([candle(300), candle(400), candle(500)], 5);
  assert.equal(chart.prependHistory([candle(0), candle(100), candle(200)]), 2);
  assert.deepEqual(chart.candles.map((c) => c.time), [100, 200, 300, 400, 500]);
  chart.updateCandle(candle(600));
  assert.equal(chart.candles.length, 5);
  assert.deepEqual(chart.candles.map((c) => c.time), [200, 300, 400, 500, 600]);
});

test('recent reconnect bars refresh overlaps without wiping prior pages', () => {
  const chart = fakeChart([candle(0), candle(100), candle(200), candle(300)]);
  chart.replaceRecentHistory([candle(200, 105), candle(300, 110), candle(400, 115)]);
  assert.deepEqual(chart.candles.map((c) => c.time), [0, 100, 200, 300, 400]);
  assert.equal(chart.candles[2].close, 105);
});

test('Binance historical endpoint applies oldest-exclusive millisecond cursor', async () => {
  let observed;
  await fetchCandles('spot', 'BTCUSDT', '5m', undefined, 1000, async (url) => {
    observed = url;
    return { ok: true, json: async () => [[300000, '100','101','99','100','1']] };
  }, 900000);
  assert.match(observed, /endTime=899999/);
  assert.match(observed, /limit=1000/);
  assert.throws(() => fetchCandles('spot', 'BTCUSDT','5m',undefined,1000,
    async () => ({ ok:true, json:async()=>[] }), -1), RangeError);
});

test('Coinbase historical window requests less than 300 bars ending before cursor', async () => {
  let observed;
  const cursor = Date.UTC(2026, 9, 22, 8, 0);
  await fetchCoinbaseCandles('BTCUSD', '5m', undefined, async (url) => {
    observed = new URL(url);
    return { ok: true, json: async () => [] };
  }, cursor);
  assert.equal(observed.searchParams.get('granularity'), '300');
  const end = Date.parse(observed.searchParams.get('end'));
  const start = Date.parse(observed.searchParams.get('start'));
  assert.equal(end, cursor - 1);
  assert.equal(end - start, 299 * 300000);
  assert.ok(start < end);
});

test('near-left chart load invokes callback once per pending page', async () => {
  const chart = fakeChart([candle(0), candle(1), candle(2)]);
  chart.historyGeneration = 0;
  chart.historyPending = false;
  chart.historyExhausted = false;
  chart.historyRetryAfter = 0;
  chart.computeFrame = () => ({ start: 0 });
  let count = 0;
  chart.onHistoryNeeded = async () => {
    count++;
    return true;
  };
  chart.maybeNeedHistory();
  chart.maybeNeedHistory();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(count, 1);
  assert.equal(chart.historyPending, false);
  chart.onHistoryNeeded = async () => false;
  chart.maybeNeedHistory();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(chart.historyExhausted, true);
});

test('old page completion cannot mark a newly selected market exhausted', async () => {
  const chart = fakeChart([candle(0), candle(1), candle(2)]);
  chart.historyGeneration = 0;
  chart.historyPending = false;
  chart.historyExhausted = false;
  chart.historyRetryAfter = 0;
  chart.computeFrame = () => ({ start: 0 });
  let settle;
  chart.onHistoryNeeded = () => new Promise((resolve) => { settle = resolve; });
  chart.maybeNeedHistory();
  await new Promise((resolve) => setTimeout(resolve, 0));
  chart.historyGeneration++;
  chart.historyPending = false;
  chart.historyExhausted = false;
  settle(false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(chart.historyExhausted, false);
});
