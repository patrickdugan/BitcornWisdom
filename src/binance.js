import { INTERVALS, normalizeDepth, parseKline, parseKlineEvent, parseTrade } from './core.js';

const HOSTS = Object.freeze({
  spot: {
    rest: ['https://data-api.binance.vision', 'https://api.binance.com'],
    path: '/api/v3/klines',
    // Dedicated market-data domain does not require an API key.
    stream: 'wss://data-stream.binance.vision/stream?streams='
  },
  futures: {
    rest: ['https://fapi.binance.com'],
    path: '/fapi/v1/klines',
    stream: 'wss://fstream.binance.com/market/stream?streams='
  }
});

export function checkMarket(market, symbol, interval) {
  if (!Object.hasOwn(HOSTS, market)) throw new RangeError('Unknown market');
  if (!/^[A-Z0-9]{4,24}$/.test(symbol)) throw new RangeError('Invalid symbol');
  if (!INTERVALS.includes(interval)) throw new RangeError('Invalid timeframe');
}

export function streamUrl(market, symbol, interval) {
  checkMarket(market, symbol, interval);
  const s = symbol.toLowerCase();
  return HOSTS[market].stream +
    [s + '@kline_' + interval, s + '@trade', s + '@depth20@100ms'].join('/');
}

export async function fetchCandles(market, symbol, interval, signal, limit = 1000) {
  checkMarket(market, symbol, interval);
  const conf = HOSTS[market];
  const query = new URLSearchParams({ symbol, interval, limit: String(Math.min(1000, Math.max(1, limit))) });
  let error;
  for (const host of conf.rest) {
    try {
      const response = await fetch(host + conf.path + '?' + query.toString(), {
        signal, headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error('Binance ' + response.status + ' from ' + host);
      const body = await response.json();
      if (!Array.isArray(body)) throw new Error('Unexpected candle response');
      return body.map(parseKline).sort((a, b) => a.time - b.time);
    } catch (cause) {
      if (signal?.aborted) throw cause;
      error = cause;
    }
  }
  throw new Error('Market data unavailable: ' + (error?.message || 'network error'));
}

/** Combined public websocket. The caller owns one connection per active market. */
export class BinanceStream {
  constructor(market, symbol, interval, callbacks) {
    this.url = streamUrl(market, symbol, interval);
    this.callbacks = callbacks;
    this.socket = null;
    this.retryTimer = null;
    this.attempts = 0;
    this.closed = false;
  }

  start() {
    if (!this.closed) this.connect();
    return this;
  }

  connect() {
    if (this.closed) return;
    this.callbacks.onStatus?.('connecting');
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.onopen = () => {
      if (this.closed || this.socket !== socket) return;
      this.attempts = 0;
      this.callbacks.onStatus?.('live');
    };
    socket.onmessage = ({ data }) => {
      if (this.closed || this.socket !== socket) return;
      try {
        const message = JSON.parse(data);
        const event = message.data || message;
        if (event.e === 'kline') this.callbacks.onCandle?.(parseKlineEvent(event));
        else if (event.e === 'trade') this.callbacks.onTrade?.(parseTrade(event));
        else if (Array.isArray(event.bids) && Array.isArray(event.asks)) {
          this.callbacks.onDepth?.(normalizeDepth(event));
        }
      } catch (error) {
        this.callbacks.onError?.(error);
      }
    };
    socket.onerror = () => this.callbacks.onStatus?.('disrupted');
    socket.onclose = () => {
      if (this.closed || this.socket !== socket) return;
      this.socket = null;
      this.callbacks.onStatus?.('reconnecting');
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempts++, 5)) +
        Math.floor(Math.random() * 300);
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
  }

  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onmessage = null;
      this.socket.close();
      this.socket = null;
    }
  }
}
