import { INTERVALS, parseKline, parseKlineEvent, parseTrade } from './core.js';
import { SequencedOrderBook } from './orderbook.js';
import { ReconnectingSocket } from './realtime.js';

// The futures feed was split in 2026: regular market data and high-frequency depth
// belong on different WebSocket routes.
const HOSTS = Object.freeze({
  spot: {
    rest: ['https://data-api.binance.vision', 'https://api.binance.com'],
    klines: '/api/v3/klines',
    depth: '/api/v3/depth',
    marketWs: 'wss://data-stream.binance.vision/stream?streams=',
    depthWs: 'wss://data-stream.binance.vision/ws/'
  },
  futures: {
    rest: ['https://fapi.binance.com'],
    klines: '/fapi/v1/klines',
    depth: '/fapi/v1/depth',
    marketWs: 'wss://fstream.binance.com/market/stream?streams=',
    depthWs: 'wss://fstream.binance.com/public/ws/'
  }
});

export function checkMarket(market, symbol, interval) {
  if (!Object.hasOwn(HOSTS, market)) throw new RangeError('Unknown Binance market');
  if (!/^[A-Z0-9]{4,24}$/.test(symbol)) throw new RangeError('Invalid symbol');
  if (!INTERVALS.includes(interval)) throw new RangeError('Invalid timeframe');
}

export function streamUrl(market, symbol, interval) {
  checkMarket(market, symbol, interval);
  const s = symbol.toLowerCase();
  return HOSTS[market].marketWs +
    [s + '@kline_' + interval, s + (market === 'futures' ? '@aggTrade' : '@trade')].join('/');
}

export function depthStreamUrl(market, symbol) {
  checkMarket(market, symbol, '1m');
  return HOSTS[market].depthWs + symbol.toLowerCase() + '@depth@100ms';
}

async function getJson(market, symbol, path, params, signal, requester = fetch) {
  const conf = HOSTS[market];
  const query = new URLSearchParams({ symbol, ...params });
  let lastError;
  for (const host of conf.rest) {
    try {
      const response = await requester(host + path + '?' + query.toString(), {
        signal, headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error('Binance HTTP ' + response.status + ' (' + host + ')');
      const body = await response.json();
      if (!body || typeof body !== 'object') throw new TypeError('Invalid Binance response');
      return body;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw new Error('Market data unavailable: ' + (lastError?.message || 'network error'));
}

export async function fetchCandles(market, symbol, interval, signal, limit = 1000, requester = fetch) {
  checkMarket(market, symbol, interval);
  const body = await getJson(market, symbol, HOSTS[market].klines,
    { interval, limit: String(Math.min(1000, Math.max(1, limit))) }, signal, requester);
  if (!Array.isArray(body)) throw new TypeError('Expected Binance kline array');
  return body.map(parseKline).sort((a, b) => a.time - b.time);
}

export async function fetchDepthSnapshot(market, symbol, signal, limit = 1000, requester = fetch) {
  checkMarket(market, symbol, '1m');
  if (![100, 500, 1000].includes(limit)) throw new RangeError('Unsupported snapshot limit');
  return getJson(market, symbol, HOSTS[market].depth, { limit: String(limit) }, signal, requester);
}

export class BinanceStream {
  constructor(market, symbol, interval, callbacks = {}, factory) {
    this.callbacks = callbacks;
    this.transport = new ReconnectingSocket(streamUrl(market, symbol, interval), {
      onStatus: (status) => callbacks.onStatus?.(status),
      onError: (error) => callbacks.onError?.(error),
      onMessage: (data) => {
        const parsed = JSON.parse(data);
        const event = parsed.data || parsed;
        if (event.e === 'kline') callbacks.onCandle?.(parseKlineEvent(event));
        else if (event.e === 'trade' || event.e === 'aggTrade') callbacks.onTrade?.(parseTrade(event));
      }
    }, factory);
  }

  start() { this.transport.start(); return this; }
  close() { this.transport.close(); }
}

/**
 * A public WS diff-depth stream plus a REST snapshot.
 * A book is emitted only after an overlapping snapshot/stream sequence.
 * Any missed ID forces a fresh snapshot, never a knowingly stale ladder.
 */
export class BinanceDepthStream {
  constructor(market, symbol, callbacks = {}, { requester = fetch, factory } = {}) {
    checkMarket(market, symbol, '1m');
    this.market = market;
    this.symbol = symbol;
    this.callbacks = callbacks;
    this.requester = requester;
    this.closed = false;
    this.syncGeneration = 0;
    this.snapshotTimer = null;
    this.controller = null;
    this.lastEmit = 0;
    this.book = new SequencedOrderBook(market, {
      onBook: (book) => {
        if (Date.now() - this.lastEmit >= 180) {
          this.lastEmit = Date.now();
          callbacks.onDepth?.(book);
        }
      },
      onStatus: (status, reason) => callbacks.onBookStatus?.(status, reason),
      onResync: () => this.scheduleSnapshot(250)
    });
    this.transport = new ReconnectingSocket(depthStreamUrl(market, symbol), {
      onOpen: () => {
        this.book.reset('connected', false);
        this.scheduleSnapshot(0);
      },
      onClose: () => {
        this.stopSnapshot();
        this.book.reset('socket disconnected', false);
      },
      onError: (error) => callbacks.onError?.(error),
      onStatus: (status) => {
        if (status === 'reconnecting' || status === 'disrupted')
          callbacks.onBookStatus?.('syncing', status);
      },
      onMessage: (data) => {
        const payload = JSON.parse(data);
        const event = payload.data || payload;
        if (event.e === 'depthUpdate') this.book.ingest(event);
      }
    }, factory);
  }

  start() { this.transport.start(); return this; }

  stopSnapshot() {
    ++this.syncGeneration;
    clearTimeout(this.snapshotTimer);
    this.snapshotTimer = null;
    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }
  }

  scheduleSnapshot(delay) {
    if (this.closed) return;
    this.stopSnapshot();
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      this.bootstrap();
    }, delay);
  }

  async bootstrap() {
    if (this.closed) return;
    const generation = ++this.syncGeneration;
    const controller = new AbortController();
    this.controller = controller;
    try {
      // When the snapshot is older than the first buffered event, refetch.
      for (let attempt = 0; attempt < 5; attempt++) {
        const body = await fetchDepthSnapshot(this.market, this.symbol,
          controller.signal, 1000, this.requester);
        if (this.closed || controller.signal.aborted || generation !== this.syncGeneration) return;
        const result = this.book.installSnapshot(body);
        if (result === 'retry') continue;
        // 'resync' has already scheduled a fresh snapshot via book.onResync.
        return;
      }
      throw new Error('Could not bridge the depth snapshot to buffered events');
    } catch (error) {
      if (!controller.signal.aborted && !this.closed) {
        this.callbacks.onError?.(error);
        this.callbacks.onBookStatus?.('syncing', 'snapshot unavailable');
        this.scheduleSnapshot(2400);
      }
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  close() {
    this.closed = true;
    this.stopSnapshot();
    this.transport.close();
  }
}
