// Optional real-browser exchange probe. Network/CORS/geo restrictions are reported,
// never counted as a deterministic test failure.
import { spawn, spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const port = 5192;
const server = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
  stdio: 'ignore'
});
async function waitServer() {
  for (let n = 0; n < 80; n++) {
    try { if ((await fetch('http://127.0.0.1:' + port)).ok) return; }
    catch { /* Server starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Local server unavailable');
}
const results = [];
try {
  await waitServer();
  for (const { name, query } of [
    { name: 'kraken', query: '?market=kraken&symbol=BTCUSD&interval=5m&demo=0' },
    { name: 'binance-spot', query: '?market=spot&symbol=BTCUSDT&interval=5m&demo=0' }
  ]) {
    const output = name + '-live-preview.png';
    const started = Date.now();
    const chrome = spawnSync(process.env.CHROME_BIN || 'google-chrome', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--disable-background-networking', '--no-first-run', '--window-size=1440,900',
      '--screenshot=' + output,
      '--virtual-time-budget=10000', '--dump-dom',
      'http://127.0.0.1:' + port + '/' + query
    ], { encoding: 'utf8', timeout: 25000, maxBuffer: 8_000_000 });
    const html = chrome.stdout || '';
    const price = html.match(/id="last-price"[^>]*>([^<]+)</)?.[1] ?? '';
    const connection = html.match(/id="connection-label"[^>]*>([^<]+)</)?.[1] ?? '';
    const book = html.match(/id="book-status"[^>]*>([^<]+)</)?.[1] ?? '';
    const error = html.match(/id="chart-error"[^>]*>([^<]*)</)?.[1] ?? '';
    const row = { name, elapsedMs: Date.now() - started, chromeExit: chrome.status,
      lastPrice: price, connection, book, error, screenshot: output,
      priceRendered: /^[\d,.]+$/.test(price), bookVerified: /checksum-verified|synchronized L2/.test(book) };
    results.push(row);
    console.log(JSON.stringify(row));
  }
} finally {
  server.kill();
}
await writeFile('live-browser-report.json', JSON.stringify({
  generatedAt: new Date().toISOString(), caveat: 'Runner-specific public feed reachability', results
}, null, 2) + '\n');
// Deliberately advisory: failures on a region-blocked endpoint are operational evidence.
