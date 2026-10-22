import { INTERVAL_MS, parseKline } from './core.js';
import { ReconnectingSocket } from './realtime.js';

export const COINBASE_INTERVALS = Object.freeze({
  '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '6h': 21600, '1d': 86400
});

const QUOTES = ['USDT', 'USDC', 'USD', 'EUR', 'GBP', 'CAD', 'BTC', 'ETH'];

export function coinbaseProduct(symbol) {
  if (!/^[A-Z0-9]{4,24}$/.test(symbol)) throw new RangeError('Invalid Coinbase symbol');
  const quote = QUOTES.find((q) => symbol.endsWith(q) && symbol.length > q.length);
  if (!quote) throw new RangeError('Enter a joined Coinbase symbol, e.g. BTCUSD');
  return symbol.slice(0, -quote.length) + '-' + quote;
}

export function checkCoinbase(symbol, interval) {
  coinbaseProduct(symbol);
  if (!Object.hasOwn(COINBASE_INTERVALS, interval)) {
    throw new RangeError('Coinbase does not support that candle interval');
  }
}

export function parseCoinbaseHistory(body) {
  if (!Array.isArray(body)) throw new TypeError('Coinbase expected candle array');
  const candles = body.map((row) => {
    if (!Array.isArray(row) || row.length < 6) throw new TypeError('Invalid Coinbase candle');
    // Coinbase format: [Unix seconds, low, high, open, close, volume].
    return parseKline([Number(row[0]) * 1000, row[3], row[2], row[1], row[4], row[5]]);
  }).sort((a, b) => a.time - b.time);
  return candles.filter((c, i) => i === 0 || c.time !== candles[i - 1].time);
}

export async function fetchCoinbaseCandles(symbol, interval, signal, requester = fetch, endBefore = null) {
  checkCoinbase(symbol, interval);
  const product = coinbaseProduct(symbol);
  const params = new URLSearchParams({ granularity: String(COINBASE_INTERVALS[interval]) });
  if (endBefore !== null) {
    if (!Number.isSafeInteger(endBefore) || endBefore < 1) throw new RangeError('Invalid history cursor');
    const stop = endBefore - 1;
    const start = Math.max(0, stop - 299 * INTERVAL_MS[interval]);
    params.set('start', new Date(start).toISOString());
    params.set('end', new Date(stop).toISOString());
  }
  const url = 'https://api.exchange.coinbase.com/products/' + product +
    '/candles?' + params.toString();
  const response = await requester(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Coinbase Exchange HTTP ' + response.status);
  return parseCoinbaseHistory(await response.json());
}

function parseLevel(row) {
  if (!Array.isArray(row) || row.length < 2) throw new TypeError('Invalid Coinbase level');
  const price = Number(row[0]), size = Number(row[1]);
  if (!Number.isFinite(price) || !Number.isFinite(size) || price <= 0 || size < 0) {
    throw new TypeError('Invalid Coinbase book value');
  }
  return [price, size];
}

/** Coinbase Exchange level2_batch is an ordered, snapshot-fed absolute-size book. */
export class CoinbaseBook {
  constructor(maxLevels = 1000) {
    if (!Number.isInteger(maxLevels) || maxLevels < 10 || maxLevels > 10000) {
      throw new RangeError('Invalid local L2 limit');
    }
    this.maxLevels = maxLevels;
    this.reset();
  }

  reset() {
    this.bids = new Map();
    this.asks = new Map();
    this.ready = false;
  }

  snapshotRows() {
    const bids = [...this.bids].sort((a, b) => b[0] - a[0]);
    const asks = [...this.asks].sort((a, b) => a[0] - b[0]);
    // Coinbase can supply its entire depth book. Bound browser memory after each message.
    this.bids = new Map(bids.slice(0, this.maxLevels));
    this.asks = new Map(asks.slice(0, this.maxLevels));
    return {
      bids: bids.slice(0, this.maxLevels),
      asks: asks.slice(0, this.maxLevels)
    };
  }

  apply(message) {
    if (message.type === 'snapshot') {
      if (!Array.isArray(message.bids) || !Array.isArray(message.asks)) {
        throw new TypeError('Missing Coinbase book snapshot');
      }
      const bids = new Map(), asks = new Map();
      for (const row of message.bids) {
        const [price, size] = parseLevel(row);
        if (size > 0) bids.set(price, size);
      }
      for (const row of message.asks) {
        const [price, size] = parseLevel(row);
        if (size > 0) asks.set(price, size);
      }
      this.bids = bids;
      this.asks = asks;
      this.ready = true;
    } else if (message.type === 'l2update') {
      if (!this.ready) return null;
      if (!Array.isArray(message.changes)) throw new TypeError('Invalid Coinbase updates');
      for (const row of message.changes) {
        if (!Array.isArray(row) || row.length < 3) throw new TypeError('Invalid L2 update row');
        const side = row[0];
        if (!['buy','sell'].includes(side)) throw new TypeError('Invalid Coinbase book side');
        const [price, size] = parseLevel([row[1], row[2]]);
        const levels = side === 'buy' ? this.bids : this.asks;
        if (size === 0) levels.delete(price);
        else levels.set(price, size);
      }
    } else {
      return null;
    }

    const levels = this.snapshotRows();
    if (!levels.bids.length || !levels.asks.length ||
        levels.bids[0][0] >= levels.asks[0][0]) {
      this.reset();
      throw new Error('Coinbase local book invalid or crossed');
    }
    const timestamp = Date.parse(message.time);
    return {
      source: 'coinbase-level2',
      time: Number.isFinite(timestamp) ? timestamp : Date.now(),
      bids: levels.bids, asks: levels.asks
    };
  }
}

export function parseCoinbaseTrade(message) {
  if (!message || message.type !== 'match') throw new TypeError('Expected Coinbase match');
  const price = Number(message.price), quantity = Number(message.size);
  const time = Date.parse(message.time);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) ||
      quantity <= 0 || !Number.isFinite(time)) {
    throw new TypeError('Invalid Coinbase trade');
  }
  if (!['buy', 'sell'].includes(message.side)) throw new TypeError('Unknown maker side');
  // The Coinbase Exchange match.side is the MAKER side; display TAKER aggression.
  return {
    id: Number(message.trade_id), time, price, quantity,
    side: message.side === 'buy' ? 'sell' : 'buy'
  };
}

/** Increment OHLCV only for fresh trades received after the history bootstrap. */
export class CoinbaseCandleBuilder {
  constructor(interval) {
    if (!Object.hasOwn(COINBASE_INTERVALS, interval)) throw new RangeError('Invalid timeframe');
    this.periodMs = INTERVAL_MS[interval];
    this.candle = null;
    this.lastTradeId = -1;
  }

  seed(candle) {
    this.candle = candle ? { ...candle } : null;
  }

  ingest(trade) {
    if (Number.isFinite(trade.id) && trade.id <= this.lastTradeId) return null;
    if (Number.isFinite(trade.id)) this.lastTradeId = trade.id;
    const time = Math.floor(trade.time / this.periodMs) * this.periodMs;
    if (!this.candle || time > this.candle.time) {
      return (this.candle = {
        time, open: trade.price, high: trade.price, low: trade.price,
        close: trade.price, volume: trade.quantity
      });
    }
    if (time < this.candle.time) return null;
    return (this.candle = {
      ...this.candle,
      high: Math.max(this.candle.high, trade.price),
      low: Math.min(this.candle.low, trade.price),
      close: trade.price, volume: this.candle.volume + trade.quantity
    });
  }
}

/** Detect missing match messages against Coinbase's last_trade_id heartbeat. */
export class CoinbaseTradeGapMonitor {
  constructor(graceMs = 2500, cooldownMs = 30000) {
    this.graceMs = graceMs;
    this.cooldownMs = cooldownMs;
    this.gapSince = null;
    this.lastRefreshAt = -Infinity;
  }

  observe(heartbeatTradeId, latestMatchId, now = Date.now()) {
    if (!Number.isSafeInteger(heartbeatTradeId) ||
        !Number.isSafeInteger(latestMatchId) || latestMatchId < 0) return false;
    if (heartbeatTradeId <= latestMatchId) {
      this.gapSince = null;
      return false;
    }
    if (this.gapSince === null) {
      this.gapSince = now;
      return false;
    }
    if (now - this.gapSince >= this.graceMs &&
        now - this.lastRefreshAt >= this.cooldownMs) {
      this.lastRefreshAt = now;
      this.gapSince = now;
      return true;
    }
    return false;
  }

  reset() { this.gapSince = null; }
}

export class CoinbaseStream {
  constructor(symbol, interval, callbacks = {}, factory, { chartOnly = false } = {}) {
    checkCoinbase(symbol, interval);
    this.product = coinbaseProduct(symbol);
    this.callbacks = callbacks;
    this.chartOnly = chartOnly;
    this.book = new CoinbaseBook();
    this.builder = new CoinbaseCandleBuilder(interval);
    this.tradeGap = new CoinbaseTradeGapMonitor();
    this.lastBookEmit = 0;
    this.seenConnection = false;

    this.transport = new ReconnectingSocket('wss://ws-feed.exchange.coinbase.com', {
      onStatus: (status) => callbacks.onStatus?.(status),
      onError: (error) => callbacks.onError?.(error),
      onClose: () => {
        this.book.reset();
        this.tradeGap.reset();
        callbacks.onBookStatus?.('syncing', 'reconnecting');
      },
      onOpen: (socket) => {
        this.book.reset();
        callbacks.onBookStatus?.('syncing', 'waiting for Coinbase snapshot');
        if (this.seenConnection) callbacks.onResyncHistory?.();
        this.seenConnection = true;
        socket.send(JSON.stringify({
          type: 'subscribe',
          product_ids: [this.product],
          channels: this.chartOnly ? ['matches','heartbeat'] : ['level2_batch','matches','heartbeat']
        }));
      },
      onMessage: (text) => this.message(text)
    }, factory);
  }

  seedHistory(candles) {
    this.builder.seed(candles.at(-1) || null);
  }

  message(raw) {
    const message = JSON.parse(raw);
    if (message.type === 'error') throw new Error(message.message || 'Coinbase feed rejected subscription');
    if (message.product_id !== this.product) return;
    if (message.type === 'snapshot' || message.type === 'l2update') {
      try {
        const book = this.book.apply(message);
        if (book) {
          this.callbacks.onBookStatus?.('live');
          if (message.type === 'snapshot' || Date.now() - this.lastBookEmit > 190) {
            this.lastBookEmit = Date.now();
            this.callbacks.onDepth?.(book);
          }
        }
      } catch (error) {
        this.callbacks.onError?.(error);
        this.callbacks.onBookStatus?.('syncing', 'book invalid');
        this.transport.reconnect();
      }
    } else if (message.type === 'last_match') {
      // A replayed last fill marks where the new subscription starts.
      const lastId = Number(message.trade_id);
      if (Number.isSafeInteger(lastId)) {
        this.builder.lastTradeId = Math.max(this.builder.lastTradeId, lastId);
      }
    } else if (message.type === 'heartbeat') {
      const latestId = Number(message.last_trade_id);
      if (this.tradeGap.observe(latestId, this.builder.lastTradeId)) {
        this.callbacks.onFeedWarning?.('Missed trade(s) suspected; refreshing candles');
        this.callbacks.onResyncHistory?.();
      }
    } else if (message.type === 'match') {
      const trade = parseCoinbaseTrade(message);
      this.callbacks.onTrade?.(trade);
      const candle = this.builder.ingest(trade);
      if (candle) this.callbacks.onCandle?.(candle);
    }
    // Trade-gap detection uses Coinbase heartbeats and a cooldown to avoid excessive REST calls.
  }

  start() { this.transport.start(); return this; }
  close() { this.transport.close(); }
}
