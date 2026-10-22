import { BinanceStream, fetchCandles } from './binance.js';
import { KrakenStream, fetchKrakenCandles } from './kraken.js';
import { CoinbaseStream, fetchCoinbaseCandles } from './coinbase.js';
import { ReconnectingSocket } from './realtime.js';
import { normalizeHistory, normalizeCandle } from './feed-policy.js';

// Opt-in relays implement this read-only protocol:
// GET {base}/v1/candles?instrument=BTC-USD-SPOT&interval=1m&limit=900
// -> {instrument,interval,candles:[{time,open,high,low,close,volume}]}
// WS  {base}/v1/stream?instrument=...&interval=...
// -> {type:"candle",instrument,interval,candle:{...}} | {type:"heartbeat",instrument,interval}
// Relays are expressly user-configured and untrusted; they do not attest to L2.
export function relayUrls(source) {
  if (source?.kind !== 'relay' || typeof source.baseUrl !== 'string')
    throw new TypeError('Expected an opted-in relay source');
  const base = new URL(source.baseUrl + '/');
  const candles = new URL('v1/candles', base);
  candles.search = new URLSearchParams({
    instrument: source.instrument, interval: source.interval, limit: '900'
  }).toString();
  const stream = new URL('v1/stream', base);
  stream.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  stream.search = new URLSearchParams({
    instrument: source.instrument, interval: source.interval
  }).toString();
  return { candles: candles.href, stream: stream.href };
}

export function parseRelayHistory(body, source) {
  if (!body || body.instrument !== source.instrument ||
    body.interval !== source.interval)
    throw new TypeError('Relay history instrument or interval mismatch');
  return normalizeHistory(body.candles, 900);
}

export function parseRelayMessage(raw, source) {
  if (typeof raw !== 'string' || raw.length > 16384) throw new TypeError('Oversized relay frame');
  const item = JSON.parse(raw);
  if (!item || item.instrument !== source.instrument || item.interval !== source.interval)
    throw new TypeError('Relay stream instrument mismatch');
  if (item.type === 'heartbeat') return { type: 'heartbeat' };
  if (item.type === 'candle') return { type: 'candle', candle: normalizeCandle(item.candle) };
  throw new TypeError('Unsupported relay frame');
}

export async function openFeedSource(source, callbacks, signal, {
  requester = fetch, socketFactory
} = {}) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (source.kind === 'relay') {
    const urls = relayUrls(source);
    const response = await requester(urls.candles, {
      signal, headers: { Accept: 'application/json' }, credentials: 'omit'
    });
    if (!response.ok) throw new Error('Relay history HTTP ' + response.status);
    const rows = parseRelayHistory(await response.json(), source);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    callbacks.onHistory(rows);
    const stream = new ReconnectingSocket(urls.stream, {
      onStatus: callbacks.onStatus,
      onError: callbacks.onError,
      onMessage(raw) {
        const message = parseRelayMessage(raw, source);
        if (message.type === 'heartbeat') callbacks.onHeartbeat();
        else callbacks.onCandle(message.candle);
      }
    }, socketFactory);
    stream.start();
    if (signal?.aborted) { stream.close(); throw new DOMException('Aborted', 'AbortError'); }
    return { close: () => stream.close() };
  }

  let history;
  if (source.market === 'kraken')
    history = await fetchKrakenCandles(source.symbol, source.interval, signal, requester);
  else if (source.market === 'coinbase')
    history = await fetchCoinbaseCandles(source.symbol, source.interval, signal, requester);
  else if (['spot', 'futures'].includes(source.market))
    history = await fetchCandles(source.market, source.symbol, source.interval,
      signal, 900, requester);
  else throw new RangeError('Unknown exchange adapter');
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  callbacks.onHistory(history);
  const streamCallbacks = {
    onStatus: callbacks.onStatus,
    onCandle: callbacks.onCandle,
    onTrade: callbacks.onHeartbeat,
    onError: callbacks.onError,
    onDepth: () => {},
    onResyncHistory: async () => {
      if (signal?.aborted) return;
      try {
        if (source.market !== 'coinbase') return;
        const updated = await fetchCoinbaseCandles(source.symbol, source.interval, signal, requester);
        if (!signal?.aborted) callbacks.onHistory(updated);
      } catch (error) {
        if (!signal?.aborted) callbacks.onError(error);
      }
    }
  };
  let stream;
  if (source.market === 'kraken')
    stream = new KrakenStream(source.symbol, source.interval,
      streamCallbacks, socketFactory, { chartOnly: true });
  else if (source.market === 'coinbase') {
    stream = new CoinbaseStream(source.symbol, source.interval,
      streamCallbacks, socketFactory, { chartOnly: true });
    stream.seedHistory(history);
  } else stream = new BinanceStream(source.market, source.symbol,
    source.interval, streamCallbacks, socketFactory);
  stream.start();
  if (signal?.aborted) { stream.close(); throw new DOMException('Aborted', 'AbortError'); }
  return { close: () => stream.close() };
}
