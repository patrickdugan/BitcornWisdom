// Serializable, bounded multi-chart layouts. No direct DOM or network dependencies.
export const GRID_MODES = Object.freeze([1, 2, 4]);
export const GRID_MARKETS = Object.freeze(['spot', 'futures', 'kraken', 'coinbase']);
export const GRID_INTERVALS = Object.freeze({
  spot: ['1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d','3d','1w'],
  futures: ['1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d','3d','1w'],
  kraken: ['1m','5m','15m','30m','1h','4h','1d','1w'],
  coinbase: ['1m','5m','15m','1h','6h','1d']
});
export const GRID_DEFAULTS = Object.freeze([
  { market: 'spot', symbol: 'BTCUSDT', interval: '5m' },
  { market: 'spot', symbol: 'ETHUSDT', interval: '5m' },
  { market: 'kraken', symbol: 'BTCUSD', interval: '1h' },
  { market: 'coinbase', symbol: 'BTCUSD', interval: '15m' }
]);
export function normalizeGridCell(raw, index = 0) {
  const fallback = GRID_DEFAULTS[index % GRID_DEFAULTS.length];
  if (!raw || typeof raw !== 'object' || !GRID_MARKETS.includes(raw.market)) return { ...fallback };
  const symbol = String(raw.symbol || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,24}$/.test(symbol)) return { ...fallback };
  return {
    market: raw.market,
    symbol,
    interval: GRID_INTERVALS[raw.market].includes(raw.interval) ? raw.interval : '5m'
  };
}
export function normalizeGridLayout(raw) {
  const mode = GRID_MODES.includes(raw?.mode) ? raw.mode : 2;
  return {
    version: 1,
    mode,
    syncCrosshair: raw?.syncCrosshair !== false,
    syncRange: raw?.syncRange === true,
    demo: Boolean(raw?.demo),
    cells: Array.from({ length: 4 }, (_, index) => normalizeGridCell(raw?.cells?.[index], index))
  };
}
export function gridKey(market) {
  return [market.market, market.symbol, market.interval].join(':');
}
export function saveGridLayout(storage, layout, key = 'bitcornwisdom:grid:v1') {
  const canonical = normalizeGridLayout(layout);
  storage.setItem(key, JSON.stringify(canonical));
  return canonical;
}
export function loadGridLayout(storage, key = 'bitcornwisdom:grid:v1') {
  try { return normalizeGridLayout(JSON.parse(storage.getItem(key))); }
  catch { return normalizeGridLayout(null); }
}
