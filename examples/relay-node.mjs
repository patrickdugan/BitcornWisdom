// Minimal, read-only BitcornWisdom v0.11 relay. Node 22+, zero dependencies.
// This example forwards Kraken OHLCV over an independently hosted endpoint.
// A relay of Kraken remains dependent on Kraken; it is not an independent oracle.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchKrakenCandles, krakenSymbols, parseKrakenCandle, KRAKEN_INTERVALS } from '../src/kraken.js';
import { normalizeCandle, resolveInstrument } from '../src/feed-policy.js';

const HANDSHAKE_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const HEARTBEAT_MS = 10000;
const MAX_WS_BYTES = 16384;
const MAX_CONNECTIONS = 16;

export function relayMarket(instrument, interval) {
  const specification = resolveInstrument(instrument);
  if (specification.quote !== 'USD' || specification.product !== 'spot' ||
    !specification.intervals.includes(interval) ||
    !specification.venues.some(source => source.market === 'kraken'))
    throw new RangeError('Reference relay supports Kraken BTC/USD or ETH/USD spot');
  const symbol = instrument === 'BTC-USD-SPOT' ? 'BTCUSD' : 'ETHUSD';
  return { instrument, interval, symbol, wire: krakenSymbols(symbol).wire };
}

function sendJSON(socket, value) {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  if (bytes.length > MAX_WS_BYTES || socket.destroyed ||
    !socket.writable || socket.writableLength > 1024 * 1024) {
    socket.destroy();
    return false;
  }
  const header = bytes.length < 126 ?
    Buffer.from([0x81, bytes.length]) :
    Buffer.from([0x81, 126, (bytes.length >> 8) & 255, bytes.length & 255]);
  socket.write(Buffer.concat([header, bytes]));
  return true;
}

function reply(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  }).end(JSON.stringify(body));
}

export function makeRelayServer({
  requester = fetch,
  upstreamFactory = url => new WebSocket(url),
  allowedOrigin = '*',
  upstreamUrl = 'wss://ws.kraken.com/v2',
  clock = () => Date.now()
} = {}) {
  if (!(allowedOrigin === '*' || /^https?:\/\/[^\s/]+$/.test(allowedOrigin)))
    throw new RangeError('CORS_ORIGIN must be "*" or an exact HTTP(S) origin');
  const sessions = new Set();
  const cors = { 'Access-Control-Allow-Origin': allowedOrigin, 'Vary': 'Origin' };
  const created = clock();
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Accept',
        'Access-Control-Max-Age': '600'
      }).end();
      return;
    }
    if (req.method !== 'GET') return reply(res, 405, { error: 'Read only' }, cors);
    let route;
    try { route = new URL(req.url, 'http://localhost'); }
    catch { return reply(res, 400, { error: 'Invalid URL' }, cors); }
    if (route.pathname === '/health') {
      return reply(res, 200, {
        service: 'bitcornwisdom-relay', mode: 'kraken-forwarder',
        source: 'kraken', activeClients: sessions.size, uptimeMs: clock() - created,
        verifiedL2: false
      }, cors);
    }
    if (route.pathname !== '/v1/candles')
      return reply(res, 404, { error: 'Unknown path' }, cors);
    let market;
    try {
      market = relayMarket(route.searchParams.get('instrument'),
        route.searchParams.get('interval'));
      if (route.searchParams.get('limit') !== '900')
        throw new RangeError('This relay serves up to 900 recent bars');
    } catch(error) {
      return reply(res, 400, { error: error.message }, cors);
    }
    try {
      const signal = AbortSignal.timeout(8500);
      const candles = await fetchKrakenCandles(market.symbol, market.interval,
        signal, requester);
      return reply(res, 200, {
        instrument: market.instrument, interval: market.interval,
        source: { venue: 'kraken', via: 'read-only-forwarder', verifiedL2: false },
        candles: candles.slice(-900).map(normalizeCandle)
      }, cors);
    } catch(error) {
      return reply(res, 502, { error: 'Upstream Kraken history unavailable' }, cors);
    }
  });

  server.on('upgrade', (req, socket, head) => {
    if (sessions.size >= MAX_CONNECTIONS) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    let route, market;
    try {
      route = new URL(req.url, 'http://localhost');
      if (route.pathname !== '/v1/stream') throw new RangeError('Unknown WS path');
      market = relayMarket(route.searchParams.get('instrument'),
        route.searchParams.get('interval'));
      if (route.searchParams.get('limit')) throw new RangeError('Unexpected parameter');
      if (allowedOrigin !== '*' && req.headers.origin !== allowedOrigin)
        throw new RangeError('Unauthorized origin');
      if (req.headers.upgrade?.toLowerCase() !== 'websocket' ||
        req.headers['sec-websocket-version'] !== '13')
        throw new TypeError('WebSocket version 13 required');
      const key = req.headers['sec-websocket-key'];
      if (typeof key !== 'string' || Buffer.from(key,'base64').length !== 16)
        throw new TypeError('Malformed WebSocket key');
    } catch(error) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }

    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] +
      HANDSHAKE_MAGIC).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    let upstream = null, heartbeat = null, closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      sessions.delete(socket);
      clearInterval(heartbeat);
      try { upstream?.close(); } catch {}
      socket.destroy();
    };
    sessions.add(socket);
    socket.on('error', close);
    socket.on('end', close);
    socket.on('close', close);
    // This is a one-way read-only subscription. Ignore application frames,
    // but bound any inbound data so clients cannot build unbounded buffers.
    socket.on('data', chunk => {
      if (chunk.length > 8192) close();
      if (chunk[0] === 0x88) close();
    });
    if (head?.length > 8192) close();
    if (closed) return;
    try {
      upstream = upstreamFactory(upstreamUrl);
      upstream.onopen = () => {
        upstream.send(JSON.stringify({
          method: 'subscribe',
          params: { channel: 'ohlc', symbol: [market.wire],
            interval: KRAKEN_INTERVALS[market.interval], snapshot: true }
        }));
      };
      upstream.onmessage = ({ data }) => {
        try {
          const message = JSON.parse(String(data));
          if (message.channel !== 'ohlc' || !Array.isArray(message.data)) return;
          for (const item of message.data) {
            if (item.symbol !== market.wire) continue;
            const candle = normalizeCandle(parseKrakenCandle(item));
            sendJSON(socket, {
              type: 'candle', instrument: market.instrument,
              interval: market.interval, candle
            });
          }
        } catch { /* Ignore malformed upstream frames; never forge OHLCV. */ }
      };
      upstream.onerror = close;
      upstream.onclose = close;
      heartbeat = setInterval(() => {
        sendJSON(socket, { type: 'heartbeat', instrument:market.instrument,
          interval:market.interval });
      }, HEARTBEAT_MS);
    } catch { close(); }
  });

  return { server, connections: () => sessions.size, closeAll() {
    for (const socket of [...sessions]) socket.destroy();
  } };
}

// Default to loopback. For public access, place a rate-limited HTTPS/WSS
// reverse proxy in front of this sample, with explicit origin policy.
if (process.argv[1] &&
  fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))) {
  const port = Number(process.env.PORT || 8722);
  const host = process.env.HOST || '127.0.0.1';
  const relay = makeRelayServer({ allowedOrigin:process.env.CORS_ORIGIN || '*' });
  relay.server.listen(port, host, () =>
    console.log('Bitcorn relay at http://' + host + ':' + port));
}
