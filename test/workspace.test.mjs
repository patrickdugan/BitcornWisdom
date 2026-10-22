import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_IDS, CHART_COLORS, MARKET_PRESETS, MARKET_NAMES, MAX_FAVORITES,
  marketKey, symbolLabel, normalTheme, normalizedMarket,
  sanitizeFavorites, toggleFavorite, isFavorite, searchPalette
} from '../src/workspace.js';
import { sma, bollingerBands, rsi } from '../src/indicators.js';
import { CandleChart } from '../src/chart.js';

test('all workspace themes have palettes and sanitize invalid persisted choices', () => {
  assert.deepEqual(THEME_IDS, ['noir', 'synth', 'verdigris']);
  assert.equal(normalTheme('unknown-theme'), 'noir');
  for (const id of THEME_IDS) {
    assert.equal(normalTheme(id), id);
    assert.ok(CHART_COLORS[id].bg.startsWith('#'));
    assert.ok(CHART_COLORS[id].up.startsWith('#'));
    assert.ok(CHART_COLORS[id].rsi.startsWith('#'));
  }
});

test('markets are validated, canonically uppercased and uniquely keyed', () => {
  assert.deepEqual(normalizedMarket({ market: 'spot', symbol: ' btcusdt ' }),
    { market: 'spot', symbol: 'BTCUSDT' });
  assert.equal(normalizedMarket({ market: 'binance-admin', symbol: 'BTCUSDT' }), null);
  assert.equal(normalizedMarket({ market: 'spot', symbol: '<script>' }), null);
  assert.equal(normalizedMarket({ market: 'spot', symbol: 100 }), null);
  assert.equal(marketKey({ market: 'kraken', symbol: 'BTCUSD' }), 'kraken:BTCUSD');
  assert.equal(symbolLabel('BTCUSDT'), 'BTC / USDT');
  assert.equal(symbolLabel('ETHUSD'), 'ETH / USD');
  assert.equal(MARKET_NAMES.futures, 'Binance · Perpetual');
  assert.ok(MARKET_PRESETS.length >= 5);
});

test('favorites deduplicate, reject injected fields and enforce storage cap', () => {
  const invalid = { market: 'spot', symbol: '../../secrets' };
  const favorite = { market: 'spot', symbol: 'btcusdt', extra: 'ignored' };
  assert.deepEqual(sanitizeFavorites([favorite, { market:'spot', symbol:'BTCUSDT' }, invalid]),
    [{ market: 'spot', symbol: 'BTCUSDT' }]);
  const many = Array.from({ length: 45 }, (_, i) => ({
    market: 'spot', symbol: 'MKT' + String(i).padStart(4, '0') + 'USDT'
  }));
  assert.equal(sanitizeFavorites(many).length, MAX_FAVORITES);
  assert.deepEqual(sanitizeFavorites({}), []);
});

test('pin/unpin uses exact exchange and symbol identity', () => {
  const market = { market:'spot', symbol:'BTCUSDT' };
  const other = { market:'futures', symbol:'BTCUSDT' };
  const first = toggleFavorite([], market);
  assert.equal(first.length, 1);
  assert.ok(isFavorite(first, market));
  assert.ok(!isFavorite(first, other));
  assert.equal(toggleFavorite(first, market).length, 0);
  assert.equal(toggleFavorite(first, other).length, 2);
  assert.throws(() => toggleFavorite([], { market:'spot', symbol:'BAD/PAIR' }), RangeError);
});

test('palette search ranks market names and preserves action queries', () => {
  const choices = [
    { title:'Toggle RSI 14', detail:'Indicator', keywords:'momentum', type:'action' },
    { title:'BTC / USDT', detail:'Binance Spot', keywords:'BTCUSDT', type:'market' },
    { title:'ETH / USD', detail:'Coinbase Exchange', keywords:'ETHUSD', type:'market' },
    { title:'Theme Afterhours', detail:'Violet colors', keywords:'synth', type:'theme' }
  ];
  assert.equal(searchPalette(choices, 'btcusdt')[0].title, 'BTC / USDT');
  assert.equal(searchPalette(choices, 'rsi')[0].title, 'Toggle RSI 14');
  assert.equal(searchPalette(choices, 'coinbase eth')[0].title, 'ETH / USD');
  assert.equal(searchPalette(choices, 'violet')[0].type, 'theme');
  assert.deepEqual(searchPalette(choices, 'not found'), []);
  assert.equal(searchPalette(choices, '', 2).length, 2);
});

test('Bollinger bands use a 20-style population variance and align with SMA', () => {
  const candles = [1, 2, 3, 4, 5, 6].map((close) => ({ close }));
  const bands = bollingerBands(candles, 3, 2);
  assert.deepEqual(bands.basis, sma(candles, 3));
  assert.equal(bands.upper[0], null);
  assert.equal(bands.lower[1], null);
  assert.ok(Math.abs(bands.upper[2] - (2 + 2 * Math.sqrt(2/3))) < 1e-12);
  assert.ok(Math.abs(bands.lower[2] - (2 - 2 * Math.sqrt(2/3))) < 1e-12);
  assert.equal(bands.basis[5], 5);
});

test('flat-market BB and RSI stay stable at large price levels', () => {
  const flat = Array.from({length:40},()=>({close:83000}));
  const bb = bollingerBands(flat, 20, 2);
  assert.equal(bb.upper.at(-1), 83000);
  assert.equal(bb.lower.at(-1), 83000);
  assert.equal(rsi(flat, 14).at(-1), 50);
  assert.throws(() => bollingerBands(flat, 1), RangeError);
  assert.throws(() => bollingerBands(flat, 20, -1), RangeError);
});

test('RSI pane reserves chart height and BB range includes indicator boundaries', () => {
  const model = Object.create(CandleChart.prototype);
  model.width = 1200; model.height = 700; model.barWidth = 8; model.offsetBars = 0;
  model.gap = 11; model.logarithmic = false; model.showBB = true; model.showRSI = true;
  model.candles = Array.from({ length: 140 }, (_, i) => {
    const close = 83000 + 220*Math.sin(i/8);
    return { time: 1000000+i*300000, open:close-15, high:close+35, low:close-35, close, volume:1+i%12 };
  });
  const frame = model.computeFrame();
  assert.ok(frame.rsiTop > frame.volumeBottom);
  assert.equal(frame.rsiBottom, model.height - 28);
  const bands = model.getIndicators().bollinger;
  assert.ok(frame.low < bands.lower.at(-1));
  assert.ok(frame.high > bands.upper.at(-1));
  assert.equal(model.getIndicators(), model.cachedIndicators);
  model.requestDraw = ()=>{};
  model.maxCandleBars = 8000;
  model.updateCandle({ ...model.candles.at(-1), close: model.candles.at(-1).close + 1 });
  assert.equal(model.cachedIndicators, null);
});
