// Small, exchange-neutral market primitives. Time is always Unix milliseconds.
export const INTERVALS = Object.freeze(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '3d', '1w']);
export const INTERVAL_MS = Object.freeze({
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000,
  '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000,
  '4h': 14_400_000, '6h': 21_600_000, '12h': 43_200_000,
  '1d': 86_400_000, '3d': 259_200_000, '1w': 604_800_000
});

function number(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError('Invalid ' + field);
  return parsed;
}

function validateCandle(candle) {
  if (candle.time < 0 || candle.low > candle.high ||
    candle.open < candle.low || candle.open > candle.high ||
    candle.close < candle.low || candle.close > candle.high || candle.volume < 0) {
    throw new TypeError('Invalid OHLCV candle');
  }
  return candle;
}

/** Binance-style 12-item REST kline array -> common candle. */
export function parseKline(row) {
  if (!Array.isArray(row) || row.length < 6) throw new TypeError('Invalid kline array');
  return validateCandle({
    time: number(row[0], 'time'),
    open: number(row[1], 'open'),
    high: number(row[2], 'high'),
    low: number(row[3], 'low'),
    close: number(row[4], 'close'),
    volume: number(row[5], 'volume')
  });
}

/** Binance WebSocket kline payload -> common candle. */
export function parseKlineEvent(event) {
  if (!event || !event.k) throw new TypeError('Invalid kline event');
  const k = event.k;
  return parseKline([k.t, k.o, k.h, k.l, k.c, k.v]);
}

/** Mutate a sorted ascending list. Returns inserted/replaced/ignored. */
export function upsertCandle(candles, candle, limit = 1200) {
  validateCandle(candle);
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (candles[mid].time < candle.time) lo = mid + 1;
    else hi = mid;
  }
  if (lo < candles.length && candles[lo].time === candle.time) {
    candles[lo] = candle;
    return 'replaced';
  }
  // Realtime reconnects can replay an old candle; do not insert it into a full window.
  if (candles.length >= limit && lo === 0) return 'ignored';
  candles.splice(lo, 0, candle);
  if (candles.length > limit) candles.splice(0, candles.length - limit);
  return 'inserted';
}

export function normalizeDepth(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.bids) || !Array.isArray(snapshot.asks)) {
    throw new TypeError('Invalid partial depth snapshot');
  }
  const levels = (rows, descending) => rows.map((row) => {
    if (!Array.isArray(row) || row.length < 2) throw new TypeError('Invalid book level');
    return [number(row[0], 'level price'), number(row[1], 'level quantity')];
  }).filter(([p, q]) => p > 0 && q > 0)
    .sort((a, b) => descending ? b[0] - a[0] : a[0] - b[0]);
  return {
    time: Date.now(),
    lastUpdateId: Number(snapshot.lastUpdateId) || 0,
    bids: levels(snapshot.bids, true),
    asks: levels(snapshot.asks, false)
  };
}

export function parseTrade(event) {
  if (!event || event.e !== 'trade') throw new TypeError('Invalid trade');
  return {
    id: event.t,
    time: number(event.T, 'trade timestamp'),
    price: number(event.p, 'trade price'),
    quantity: number(event.q, 'trade quantity'),
    // Buyer-maker trades were initiated by the seller.
    side: event.m ? 'sell' : 'buy'
  };
}

export function formatPrice(value) {
  if (!Number.isFinite(value)) return '—';
  const a = Math.abs(value);
  const decimals = a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 6 : 8;
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: decimals });
}

export function formatCompact(value) {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1_000_000) return (value / 1_000_000).toFixed(2) + 'M';
  if (Math.abs(value) >= 10_000) return (value / 1000).toFixed(1) + 'K';
  return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
