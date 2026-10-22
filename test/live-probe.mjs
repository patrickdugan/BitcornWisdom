// Explicit public-market connectivity diagnostics. Never enters the unit-test contract.
// Run: npm run probe:live. A blocked jurisdiction/CI address may report unavailable feeds.
import { writeFile } from 'node:fs/promises';
import { KrakenBook, decodeKrakenMessage } from '../src/kraken.js';

const timeoutMs = 7500;

async function rest(label, url, validate) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const json = await response.json();
    validate(json);
    return { label, ok: true, elapsedMs: Date.now() - started, detail: 'valid public JSON' };
  } catch (error) {
    return { label, ok: false, elapsedMs: Date.now() - started, detail: error.message };
  }
}

function stream(label, url, { subscribe, match } = {}) {
  const started = Date.now();
  return new Promise((resolve) => {
    let ws, timer, done = false;
    const finish = (ok, detail) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (ws) {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        try { ws.close(); } catch { /* Closing a failed handshake is harmless. */ }
      }
      resolve({ label, ok, elapsedMs: Date.now() - started, detail });
    };
    timer = setTimeout(() => finish(false, 'Timed out waiting for matching public event'), timeoutMs);
    try {
      ws = new WebSocket(url);
      ws.onopen = () => {
        if (subscribe) ws.send(JSON.stringify(subscribe));
      };
      ws.onmessage = ({ data }) => {
        try {
          const parsed = label.startsWith('Kraken') ?
            decodeKrakenMessage(String(data)) : JSON.parse(String(data));
          if (parsed.method === 'subscribe' && parsed.success === false) {
            finish(false, parsed.error || 'Subscribe rejected');
            return;
          }
          if (match(parsed)) finish(true, 'received and decoded matching exchange event');
        } catch (error) {
          finish(false, 'Invalid event: ' + error.message);
        }
      };
      ws.onerror = () => finish(false, 'WebSocket handshake or network error');
      ws.onclose = () => finish(false, 'Connection closed before matching event');
    } catch (error) { finish(false, error.message); }
  });
}

const report = await Promise.all([
  rest('Binance spot candles', 'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=2',
    (value) => { if (!Array.isArray(value) || !Array.isArray(value[0])) throw Error('Unexpected candles'); }),
  rest('Binance futures candles', 'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=2',
    (value) => { if (!Array.isArray(value) || !Array.isArray(value[0])) throw Error('Unexpected candles'); }),
  rest('Kraken spot candles', 'https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=5',
    (value) => { if (value.error?.length || !value.result) throw Error('Unexpected Kraken OHLC response'); }),
  stream('Binance spot trades', 'wss://data-stream.binance.vision/ws/btcusdt@trade', {
    match: (p) => p.e === 'trade' && Number(p.p) > 0
  }),
  stream('Binance futures trades', 'wss://fstream.binance.com/market/ws/btcusdt@aggTrade', {
    match: (p) => p.e === 'aggTrade' && Number(p.p) > 0
  }),
  stream('Binance futures sequenced depth', 'wss://fstream.binance.com/public/ws/btcusdt@depth@100ms', {
    match: (p) => p.e === 'depthUpdate' && Number.isSafeInteger(p.u)
  }),
  stream('Kraken checksum-verified book', 'wss://ws.kraken.com/v2', {
    subscribe: { method: 'subscribe',
      params: { channel: 'book', symbol: ['BTC/USD'], depth: 25, snapshot: true } },
    match: (p) => {
      if (p.channel !== 'book' || p.type !== 'snapshot') return false;
      return Boolean(new KrakenBook(25).update(p));
    }
  })
]);

await writeFile('live-probe.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  environment: 'outbound access from this host; not necessarily representative of users',
  results: report
}, null, 2) + '\n');

for (const item of report) {
  process.stdout.write((item.ok ? 'OK ' : 'BLOCKED ') +
    item.label + ' (' + item.elapsedMs + 'ms): ' + item.detail + '\n');
}
process.stdout.write('Passed ' + report.filter((x) => x.ok).length + '/' + report.length +
  ' public endpoint checks. Inspect live-probe.json for details.\n');
// An exchange or country block is operational context, not a code regression.
