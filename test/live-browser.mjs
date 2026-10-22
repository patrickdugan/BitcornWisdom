// Optional real-browser live integration diagnostic using the Chrome DevTools Protocol.
// Wait for real wall-clock seconds for verified exchange book updates.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const port = 5192;
const server = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore'
});

async function until(fn, duration = 8000) {
  const end = Date.now() + duration;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; }
    catch { /* A browser or local server may still be starting. */ }
    await sleep(150);
  }
  throw new Error('Timed out waiting for Chrome or local HTTP');
}

async function connectDevtools(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { ws.close(); reject(new Error('CDP handshake timed out')); }, 4000);
    ws.onopen = () => { clearTimeout(timer); resolve(ws); };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('CDP handshake rejected')); };
  });
}

function rpcClient(ws) {
  let id = 0;
  const outstanding = new Map();
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(String(data));
    if (message.id == null) return;
    const entry = outstanding.get(message.id);
    if (!entry) return;
    outstanding.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  };
  ws.onclose = () => {
    for (const entry of outstanding.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('DevTools connection closed'));
    }
    outstanding.clear();
  };
  return (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => {
      outstanding.delete(n);
      reject(new Error('CDP request timed out: ' + method));
    }, 5000);
    outstanding.set(n, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
}

async function launchProbe({ name, query, debugPort, grid = false }) {
  const profile = await mkdtemp(join(tmpdir(), 'bitcorn-live-'));
  const url = 'http://127.0.0.1:' + port + '/' + query;
  const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--disable-background-networking', '--window-size=1440,900',
    '--remote-debugging-port=' + debugPort, '--remote-allow-origins=*',
    '--user-data-dir=' + profile, url
  ], { stdio: 'ignore' });
  let ws;
  const started = Date.now();
  try {
    const target = await until(async () => {
      const response = await fetch('http://127.0.0.1:' + debugPort + '/json/list', {
        signal: AbortSignal.timeout(1000)
      });
      const pages = await response.json();
      return pages.find((p) => p.type === 'page' && p.url.includes('127.0.0.1:' + port));
    }, 8000);
    ws = await connectDevtools(target.webSocketDebuggerUrl);
    const send = rpcClient(ws);
    await send('Runtime.enable');
    await send('Page.enable');
    const readState = async () => {
      const response = await send('Runtime.evaluate', {
        expression: "(() => ({lastPrice: document.querySelector('#last-price')?.textContent || '', connection: document.querySelector('#connection-label')?.textContent || '', book: document.querySelector('#book-status')?.textContent || '', bookRows: document.querySelectorAll('.book-row.bid').length, error: document.querySelector('#chart-error:not([hidden])')?.textContent || ''}))()",
        returnByValue: true
      });
      return response.result?.value || {};
    };
    let state = {};
    const deadline = Date.now() + 13000;
    do {
      state = await readState();
      if (/checksum-verified|synchronized L2|snapshot-fed L2/.test(state.book) && state.bookRows > 0) break;
      if (state.error) break;
      await sleep(500);
    } while (Date.now() < deadline);
    let gridFeeds = null;
    if (grid) {
      await send('Runtime.evaluate', {
        expression: "(() => { const select=document.querySelector('#grid-layout');" +
          " select.value='4'; select.dispatchEvent(new Event('change',{bubbles:true})); return true; })()",
        returnByValue: true
      });
      gridFeeds = await until(async () => {
        const result = await send('Runtime.evaluate', {
          expression: "(() => {const p=[...document.querySelectorAll('.secondary-pane')];" +
            "return p.map(x => {const c=x.querySelector('[data-role=canvas]');" +
            "return {market:c?.dataset.market||'',symbol:c?.dataset.symbol||''," +
            "status:c?.dataset.feedStatus||'',candles:Number(c?.dataset.candles||0)}})})()",
          returnByValue: true
        });
        const panes = result.result?.value || [];
        if (panes.length === 3 && panes.every((x) => x.status === 'live' && x.candles > 0))
          return panes;
        return null;
      }, 12000).catch(() => null);
    }
    const screenshot = (await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false
    })).data;
    await writeFile(name + '-live-preview.png', Buffer.from(screenshot, 'base64'));
    let historyLoaded = null;
    if (name === 'coinbase' || name === 'binance-spot') {
      const presses = name === 'coinbase' ? 100 : 290;
      await send('Runtime.evaluate', {
        expression: "(() => { const canvas = document.querySelector('#candle-chart'); canvas.focus();" +
          " for (let i = 0; i < " + presses + "; i++) canvas.dispatchEvent(" +
          "new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); return true; })()",
        returnByValue: true
      });
      historyLoaded = await until(async () => {
        const result = await send('Runtime.evaluate', {
          expression: "document.querySelector('#market-note')?.textContent || ''",
          returnByValue: true
        });
        const note = result.result?.value || '';
        const count = /Historical candles loaded:\s*(\d+)/.exec(note)?.[1];
        return count ? Number(count) : null;
      }, 10000).catch(() => null);
    }
    return {
      name, elapsedMs: Date.now() - started, ...state,
      historyLoaded, gridFeeds,
      priceRendered: /^[0-9,.]+$/.test(state.lastPrice || ''),
      bookVerified: /checksum-verified|synchronized L2|snapshot-fed L2/.test(state.book || ''),
      screenshot: name + '-live-preview.png'
    };
  } catch (error) {
    return { name, elapsedMs: Date.now() - started, error: error.message,
      priceRendered: false, bookVerified: false };
  } finally {
    if (ws) ws.close();
    chrome.kill();
    await sleep(300);
    await rm(profile, { recursive: true, force: true, maxRetries: 2 }).catch(() => {});
  }
}

const results = [];
try {
  await until(async () => (await fetch('http://127.0.0.1:' + port)).ok, 8000);
  results.push(await launchProbe({
    name: 'kraken', query: '?market=kraken&symbol=BTCUSD&interval=5m&demo=0', debugPort: 9341
  }));
  results.push(await launchProbe({
    name: 'binance-spot', query: '?market=spot&symbol=BTCUSDT&interval=5m&demo=0', debugPort: 9342
  }));
  results.push(await launchProbe({
    name: 'coinbase', query: '?market=coinbase&symbol=BTCUSD&interval=5m&demo=0', debugPort: 9343
  }));
  results.push(await launchProbe({
    name: 'grid-live', query: '?market=spot&symbol=BTCUSDT&interval=5m&demo=0',
    debugPort: 9344, grid: true
  }));
} finally {
  server.kill();
}
await writeFile('live-browser-report.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  caveat: 'Browser observations depend on runner network, CORS and exchange accessibility',
  results
}, null, 2) + '\n');
for (const result of results) console.log(JSON.stringify(result));
// Advisory report; deterministic code quality is enforced separately by npm run check.
