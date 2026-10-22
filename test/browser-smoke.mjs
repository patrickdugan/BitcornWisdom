// Headless visual-hydration smoke test, requiring Chrome/Chromium on the host.
// Runs entirely in offline demo mode. No network requests to exchanges.
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const port = 5188;
const server = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe']
});

async function ready() {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/?demo=1');
      if (response.ok) return;
    } catch { /* server is starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Local server failed to start');
}

try {
  await ready();
  const binary = process.env.CHROME_BIN || 'google-chrome';
  const result = spawnSync(binary, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-background-networking', '--no-first-run',
    '--window-size=1440,900', '--screenshot=bitcorn-demo.png',
    '--dump-dom',
    'http://127.0.0.1:' + port + '/?demo=1'
  ], { encoding: 'utf8', timeout: 35000, maxBuffer: 8_000_000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr?.slice(-3000));
  assert.match(result.stdout, /id="connection-label"[^>]*>OFFLINE DEMO</);
  assert.match(result.stdout, /id="last-price"[^>]*>[0-9,]+\.[0-9]{2}</);
  assert.match(result.stdout, /class="book-row bid"/);
  assert.match(result.stdout, /class="trade-row (buy|sell)"/);
  console.log('Chrome demo hydration and render state: PASS');
} finally {
  server.kill();
}
