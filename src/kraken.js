import { parseKline } from './core.js';
import { ReconnectingSocket } from './realtime.js';

export const KRAKEN_INTERVALS = Object.freeze({
  '1m': 1, '5m': 5, '15m': 15, '30m': 30,
  '1h': 60, '4h': 240, '1d': 1440, '1w': 10080
});

const QUOTES = ['USDT', 'USDC', 'USD', 'EUR', 'GBP', 'CAD', 'CHF', 'JPY', 'BTC', 'ETH'];

export function krakenSymbols(symbol) {
  if (!/^[A-Z0-9]{4,24}$/.test(symbol)) throw new RangeError('Invalid Kraken symbol');
  const quote = QUOTES.find((value) => symbol.endsWith(value) && symbol.length > value.length);
  if (!quote) throw new RangeError('Kraken symbols use joined BASEQUOTE, e.g. BTCUSD');
  const base = symbol.slice(0, -quote.length).replace(/^XBT$/, 'BTC');
  return {
    wire: base + '/' + quote.replace(/^XBT$/, 'BTC'),
    // Kraken REST accepts the long-standing XBT alias for Bitcoin.
    rest: (base === 'BTC' ? 'XBT' : base) + (quote === 'BTC' ? 'XBT' : quote)
  };
}

export function checkKraken(symbol, interval) {
  krakenSymbols(symbol);
  if (!Object.hasOwn(KRAKEN_INTERVALS, interval)) {
    throw new RangeError('Kraken does not offer this OHLC interval');
  }
}

export function parseKrakenCandle(value) {
  const time = Date.parse(value?.interval_begin || value?.timestamp);
  if (!Number.isFinite(time)) throw new TypeError('Invalid Kraken candle timestamp');
  return parseKline([time, value.open, value.high, value.low, value.close, value.volume]);
}

export function parseKrakenHistory(body) {
  if (!body || !Array.isArray(body.error)) throw new TypeError('Invalid Kraken response');
  if (body.error.length) throw new Error(body.error.join('; '));
  const data = body.result || {};
  const key = Object.keys(data).find((k) => k !== 'last' && Array.isArray(data[k]));
  if (!key) throw new TypeError('Kraken returned no OHLC series');
  return data[key].map((row) => {
    if (!Array.isArray(row) || row.length < 8) throw new TypeError('Invalid Kraken OHLC row');
    // REST: [seconds, open, high, low, close, vwap, baseVolume, tradeCount].
    return parseKline([Number(row[0]) * 1000, row[1], row[2], row[3], row[4], row[6]]);
  }).sort((a, b) => a.time - b.time);
}

export async function fetchKrakenCandles(symbol, interval, signal, requester = fetch) {
  checkKraken(symbol, interval);
  const params = new URLSearchParams({
    pair: krakenSymbols(symbol).rest, interval: String(KRAKEN_INTERVALS[interval])
  });
  const response = await requester('https://api.kraken.com/0/public/OHLC?' + params, {
    signal, headers: { Accept: 'application/json' }
  });
  if (!response.ok) throw new Error('Kraken OHLC HTTP ' + response.status);
  return parseKrakenHistory(await response.json());
}

/** Preserve numeric decimal spellings needed for the Kraken CRC32 checksum. */
export function decodeKrakenMessage(text) {
  if (typeof text !== 'string') throw new TypeError('Expected text frame');
  // Parsed JS floats lose trailing zeros, which Kraken includes in the checksum.
  return JSON.parse(text.replace(/("(?:price|qty)"\s*:\s*)(-?\d+(?:\.\d+)?)/g,
    '$1"$2"'));
}

function crc32(message) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < message.length; i++) {
    crc ^= message.charCodeAt(i);
    for (let b = 0; b < 8; b++)
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function checksumPart(value) {
  return String(value).replace('.', '').replace(/^0+/, '') || '0';
}

export function krakenBookChecksum(asks, bids) {
  const source = [...asks.slice(0, 10), ...bids.slice(0, 10)]
    .map((row) => checksumPart(row.price) + checksumPart(row.qty)).join('');
  return crc32(source);
}

/** A price-level book verified against Kraken's top-10 CRC32. */
export class KrakenBook {
  constructor(depth = 25) {
    if (![10, 25, 100].includes(depth)) throw new RangeError('Invalid Kraken book depth');
    this.depth = depth;
    this.reset();
  }

  reset() {
    this.bids = new Map();
    this.asks = new Map();
    this.ready = false;
  }

  update(message) {
    if (message.channel !== 'book' || !Array.isArray(message.data) || !message.data.length) {
      throw new TypeError('Invalid Kraken book message');
    }
    if (message.type === 'snapshot') this.reset();
    else if (!this.ready) return null;

    const row = message.data[0];
    const updateSide = (map, rows) => {
      for (const item of (rows || [])) {
        const price = Number(item.price), qty = Number(item.qty);
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty < 0) {
          throw new TypeError('Invalid Kraken book price/quantity');
        }
        if (qty === 0) map.delete(price);
        else map.set(price, { price: String(item.price), qty: String(item.qty) });
      }
    };
    updateSide(this.bids, row.bids);
    updateSide(this.asks, row.asks);
    const sort = (map, descending) => [...map.values()].sort((a, b) =>
      descending ? Number(b.price) - Number(a.price) : Number(a.price) - Number(b.price));
    const bids = sort(this.bids, true).slice(0, this.depth);
    const asks = sort(this.asks, false).slice(0, this.depth);
    this.bids = new Map(bids.map((p) => [Number(p.price), p]));
    this.asks = new Map(asks.map((p) => [Number(p.price), p]));

    if (row.checksum != null && krakenBookChecksum(asks, bids) !== Number(row.checksum)) {
      this.reset();
      throw new Error('Kraken L2 checksum mismatch; reconnecting');
    }
    if (!bids.length || !asks.length || Number(bids[0].price) >= Number(asks[0].price)) {
      this.reset();
      throw new Error('Kraken L2 invalid or crossed book');
    }
    this.ready = true;
    return {
      time: Number.isFinite(Date.parse(row.timestamp)) ? Date.parse(row.timestamp) : Date.now(),
      source: 'checksum-verified',
      bids: bids.map((p) => [Number(p.price), Number(p.qty)]),
      asks: asks.map((p) => [Number(p.price), Number(p.qty)])
    };
  }
}

export class KrakenStream {
  constructor(symbol, interval, callbacks = {}, factory, { chartOnly = false } = {}) {
    checkKraken(symbol, interval);
    this.callbacks = callbacks;
    this.chartOnly = chartOnly;
    this.symbol = krakenSymbols(symbol).wire;
    this.interval = KRAKEN_INTERVALS[interval];
    this.book = new KrakenBook(25);
    this.lastDepthEmit = 0;
    this.transport = new ReconnectingSocket('wss://ws.kraken.com/v2', {
      onStatus: (status) => callbacks.onStatus?.(status),
      onError: (error) => callbacks.onError?.(error),
      onClose: () => {
        this.book.reset();
        callbacks.onBookStatus?.('syncing', 'reconnecting');
      },
      onOpen: (socket) => {
        this.book.reset();
        callbacks.onBookStatus?.('syncing', 'waiting for Kraken snapshot');
        const channels = this.chartOnly ?
          [{ channel: 'ohlc', symbol: [this.symbol], interval: this.interval, snapshot: true }] : [
          { channel: 'ohlc', symbol: [this.symbol], interval: this.interval, snapshot: true },
          { channel: 'trade', symbol: [this.symbol], snapshot: false },
          { channel: 'book', symbol: [this.symbol], depth: 25, snapshot: true }
        ];
        for (const params of channels) {
          socket.send(JSON.stringify({ method: 'subscribe', params }));
        }
      },
      onMessage: (text) => this.message(text)
    }, factory);
  }

  message(text) {
    const message = decodeKrakenMessage(text);
    if (message.method === 'subscribe' && message.success === false) {
      throw new Error('Kraken subscription rejected: ' + message.error);
    }
    if (message.channel === 'ohlc' && Array.isArray(message.data)) {
      for (const candle of message.data) {
        if (candle.symbol === this.symbol) this.callbacks.onCandle?.(parseKrakenCandle(candle));
      }
    } else if (message.channel === 'trade' && message.type === 'update') {
      for (const trade of message.data || []) {
        if (trade.symbol !== this.symbol) continue;
        this.callbacks.onTrade?.({
          id: trade.trade_id,
          time: Date.parse(trade.timestamp),
          side: trade.side,
          price: Number(trade.price),
          quantity: Number(trade.qty)
        });
      }
    } else if (message.channel === 'book') {
      try {
        const book = this.book.update(message);
        if (!book) return;
        this.callbacks.onBookStatus?.('live');
        if (Date.now() - this.lastDepthEmit >= 200) {
          this.lastDepthEmit = Date.now();
          this.callbacks.onDepth?.(book);
        }
      } catch (error) {
        this.callbacks.onError?.(error);
        this.callbacks.onBookStatus?.('syncing', 'checksum mismatch');
        this.transport.reconnect();
      }
    }
  }

  start() { this.transport.start(); return this; }
  close() { this.transport.close(); }
}
