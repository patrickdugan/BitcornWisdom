// Dependency-free, versioned settings and time-axis transforms for chart grids.
// A chart grid has one primary pane plus up to three independently configured panes.
export const GRID_LAYOUTS = Object.freeze([1, 2, 4]);
export const PANEL_DEFAULTS = Object.freeze([
  Object.freeze({ market: 'spot', symbol: 'ETHUSDT', interval: '15m', showEMA: true,
    showSMA: false, showBB: false, showRSI: false, logarithmic: false }),
  Object.freeze({ market: 'kraken', symbol: 'BTCUSD', interval: '1h', showEMA: true,
    showSMA: false, showBB: false, showRSI: false, logarithmic: false }),
  Object.freeze({ market: 'spot', symbol: 'SOLUSDT', interval: '5m', showEMA: true,
    showSMA: false, showBB: false, showRSI: false, logarithmic: false })
]);
const VALID_VENUES = new Set(['spot', 'futures', 'kraken', 'coinbase']);
const ALL_INTERVALS = new Set([
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h',
  '12h', '1d', '3d', '1w'
]);
export const GRID_INTERVAL_MS = Object.freeze({
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000,
  '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000,
  '4h': 14_400_000, '6h': 21_600_000, '12h': 43_200_000,
  '1d': 86_400_000, '3d': 259_200_000, '1w': 604_800_000
});
const LIMITED_INTERVALS = Object.freeze({
  kraken: new Set(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']),
  coinbase: new Set(['1m', '5m', '15m', '1h', '6h', '1d'])
});

export function normalizeGridLayout(input) {
  const n = Number(input);
  return GRID_LAYOUTS.includes(n) ? n : 1;
}

export function normalizePane(value, index = 0) {
  const defaults = PANEL_DEFAULTS[Math.min(2, Math.max(0, index))];
  if (!value || typeof value !== 'object') return { ...defaults };
  const market = VALID_VENUES.has(value.market) ? value.market : defaults.market;
  const symbol = typeof value.symbol === 'string' && /^[A-Z0-9]{4,24}$/.test(value.symbol.trim().toUpperCase()) ?
    value.symbol.trim().toUpperCase() : (market === 'kraken' || market === 'coinbase' ? 'BTCUSD' : 'BTCUSDT');
  const candidate = ALL_INTERVALS.has(value.interval) ? value.interval : defaults.interval;
  const interval = LIMITED_INTERVALS[market] && !LIMITED_INTERVALS[market].has(candidate) ? '5m' : candidate;
  return {
    market, symbol, interval,
    showEMA: value.showEMA !== undefined ? value.showEMA === true : defaults.showEMA,
    showSMA: value.showSMA !== undefined ? value.showSMA === true : defaults.showSMA,
    showBB: value.showBB !== undefined ? value.showBB === true : defaults.showBB,
    showRSI: value.showRSI !== undefined ? value.showRSI === true : defaults.showRSI,
    logarithmic: value.logarithmic !== undefined ? value.logarithmic === true : defaults.logarithmic
  };
}

export function normalizeGridPanes(value) {
  const values = Array.isArray(value) ? value : [];
  return PANEL_DEFAULTS.map((_, index) => normalizePane(values[index], index));
}

/** Continuous absolute-time map, including sparsely traded candle gaps. */
export function timeAtIndex(candles, index, intervalMs) {
  if (!candles.length || !Number.isFinite(index)) return null;
  if (candles.length === 1) return candles[0].time + index * intervalMs;
  if (index <= 0) return candles[0].time + index * intervalMs;
  if (index >= candles.length - 1)
    return candles[candles.length - 1].time + (index - candles.length + 1) * intervalMs;
  const floor = Math.floor(index);
  const fraction = index - floor;
  return candles[floor].time + fraction * (candles[floor + 1].time - candles[floor].time);
}

/** Inverse of timeAtIndex for actual candles, with outside-range extrapolation. */
export function indexAtTime(candles, time, intervalMs) {
  if (!candles.length || !Number.isFinite(time)) return null;
  if (time <= candles[0].time) return (time - candles[0].time) / intervalMs;
  const end = candles.length - 1;
  if (time >= candles[end].time)
    return end + (time - candles[end].time) / intervalMs;
  let lo = 0, hi = end;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (candles[mid].time <= time) lo = mid; else hi = mid;
  }
  return lo + (time - candles[lo].time) /
    Math.max(1, candles[hi].time - candles[lo].time);
}

/** Pure transform for a normalized target view with independent bar spacing. */
export function linkedViewForTarget({
  targetCount, targetIntervalMs, targetPlotWidth, targetRight,
  centerX, targetCenterIndex, sourceSpanMs, gap = 11
}) {
  if (![targetCount, targetIntervalMs, targetPlotWidth, targetRight,
    centerX, targetCenterIndex, sourceSpanMs, gap].every(Number.isFinite) ||
      targetCount < 1 || targetIntervalMs <= 0 || targetPlotWidth <= 0 || sourceSpanMs <= 0) {
    return null;
  }
  const barWidth = Math.max(2, Math.min(45,
    targetPlotWidth * targetIntervalMs / sourceSpanMs));
  const offsetBars = Math.max(-60, Math.min(targetCount - 1 + gap,
    targetCount - 1 + gap - (targetRight - centerX) / barWidth - targetCenterIndex));
  return { barWidth, offsetBars };
}
