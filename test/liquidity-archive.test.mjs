import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHIVE_POLICY, liquiditySeriesKey, validLiquiditySample,
  combineLiquiditySamples, liquidityWindow, LiquidityArchive
} from '../src/liquidity-archive.js';
import { LiquidityHeatmap, makeLiquiditySample, binBookLevels } from '../src/heatmap.js';

const book = (time = 10_000) => ({
  time, source: 'sequenced-depth',
  bids: [[99.95, 1.25], [99.85, 2.5]],
  asks: [[100.05, 3.25], [100.15, 4]]
});
const key = liquiditySeriesKey('spot', 'BTCUSDT', false);
const row = (at, series = key) => makeLiquiditySample(book(at - 100), 100, series, at);

function createModel() {
  const map = Object.create(LiquidityHeatmap.prototype);
  map.series = key;
  map.history = [];
  map.maxColumns = 3;
  map.maxHistory = 20;
  map.lastSample = 0;
  map.mode = 'live';
  map.replayTime = null;
  map.requestDraw = () => {};
  map.onChange = () => {};
  return map;
}

test('archive keys separate venues, symbols and demo data', () => {
  assert.equal(key, 'live:spot:BTCUSDT');
  assert.equal(liquiditySeriesKey('spot', 'BTCUSDT', true), 'demo:spot:BTCUSDT');
  assert.equal(liquiditySeriesKey('kraken', 'BTCUSD'), 'live:kraken:BTCUSD');
  assert.notEqual(liquiditySeriesKey('futures', 'BTCUSDT'), key);
  assert.throws(() => liquiditySeriesKey('spot', '../../secrets'), RangeError);
});

test('sample contains true observation clock, original book clock and sparse bins', () => {
  const rec = row(12_000);
  assert.equal(rec.at, 12_000);
  assert.equal(rec.exchangeAt, 11_900);
  assert.equal(rec.version, ARCHIVE_POLICY.version);
  assert.equal(rec.source, 'sequenced-depth');
  assert.ok(rec.levels.length <= 200);
  assert.ok(rec.levels.length > 0);
  assert.ok(validLiquiditySample(rec));
  assert.equal(makeLiquiditySample({}, 100, key, 12345), null);
  assert.equal(binBookLevels(book(), -1).length, 0);
});

test('validation rejects malformed samples and invalid historical bins', () => {
  const sample = row(12_000);
  assert.ok(!validLiquiditySample({ ...sample, price: NaN }));
  assert.ok(!validLiquiditySample({ ...sample, source: 'x'.repeat(80) }));
  assert.ok(!validLiquiditySample({ ...sample, levels: [[1, -20]] }));
  assert.ok(!validLiquiditySample({ ...sample, at: 0.5 }));
  assert.ok(!validLiquiditySample({ ...sample, levels: Array(201).fill([100, 1]) }));
});

test('restore deduplicates timestamps, sorts, bounds and accepts newer browser samples', () => {
  const combined = combineLiquiditySamples([row(4_000), row(2_000)], [
    row(3_000), { ...row(4_000), price: 101 }, row(5_000)
  ], 3);
  assert.deepEqual(combined.map((r) => r.at), [3_000, 4_000, 5_000]);
  assert.equal(combined[1].price, 101);
  assert.deepEqual(liquidityWindow(combined, 1, 2).map((r) => r.at), [3_000, 4_000]);
});

test('seek preserves replay timestamp while new observations are captured', () => {
  const model = createModel();
  model.restore([row(1_000), row(2_000), row(3_000)], key);
  assert.equal(model.getState().count, 3);
  assert.equal(model.visibleColumns.length, 3);
  model.seek(1);
  assert.equal(model.replayIndex, 1);
  assert.equal(model.getState().at, 2_000);
  model.ingest(book(4_000), 100, 4_000);
  assert.equal(model.getState().count, 4);
  assert.equal(model.mode, 'replay');
  assert.equal(model.replayIndex, 1);
  assert.deepEqual(model.visibleColumns.map((r) => r.at), [1_000, 2_000]);
  model.goLive();
  assert.equal(model.getState().at, 4_000);
  assert.deepEqual(model.visibleColumns.map((r) => r.at), [2_000, 3_000, 4_000]);
});

test('sample clock throttles duplicate depth packets and switching clears state', () => {
  const model = createModel();
  assert.ok(model.ingest(book(1000), 100, 1000));
  assert.equal(model.ingest(book(1400), 100, 1400), null);
  assert.ok(model.ingest(book(2000), 100, 2000));
  assert.equal(model.history.length, 2);
  model.clear('demo:kraken:BTCUSD');
  assert.equal(model.getState().count, 0);
  assert.equal(model.mode, 'live');
  model.restore([row(1000)], key);
  assert.equal(model.history.length, 0);
});

test('IDB wrapper gracefully rejects unsupported environments and invalid rows', async () => {
  const archive = new LiquidityArchive({ api: null, ranges: null });
  await assert.rejects(archive.open(), /unavailable/);
  await assert.rejects(archive.save({ invalid: true }), /Invalid liquidity sample/);
  assert.ok(ARCHIVE_POLICY.maxTotal >= ARCHIVE_POLICY.maxLoaded);
  assert.ok(ARCHIVE_POLICY.retentionMs > 0);
});
