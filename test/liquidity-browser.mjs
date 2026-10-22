// Real Chromium IndexedDB/replay smoke. One temporary profile, no exchange traffic.
// Synthetic demo rows are seeded to exercise replay and a long history after reload.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const port = 5207, debugPort = 9355;
const profile = await mkdtemp(join(tmpdir(), 'bitcorn-archive-'));
const server = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
  stdio: 'ignore'
});
let chrome, socket;
async function until(fn, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch { /* Browser may be loading. */ }
    await sleep(110);
  }
  throw new Error('Browser archive smoke timed out');
}
function makeClient(ws) {
  let id = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(String(data));
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    clearTimeout(task.timer);
    if (message.error) task.reject(new Error(JSON.stringify(message.error)));
    else task.resolve(message.result);
  };
  ws.onclose = () => {
    for (const task of pending.values()) {
      clearTimeout(task.timer);
      task.reject(new Error('DevTools closed'));
    }
    pending.clear();
  };
  return (method, params = {}) => new Promise((resolve, reject) => {
    const current = ++id;
    const timer = setTimeout(() => {
      pending.delete(current);
      reject(new Error('DevTools timed out: ' + method));
    }, 10000);
    pending.set(current, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: current, method, params }));
  });
}
let send;
async function evaluate(expression, awaitPromise = false) {
  const result = await send('Runtime.evaluate', {
    expression, awaitPromise, returnByValue: true
  });
  if (result.exceptionDetails) throw new Error(
    result.exceptionDetails.text || 'Browser evaluation failed');
  return result.result?.value;
}

function browserView() {
  return {
    count: Number(document.querySelector('#liquidity-count')?.textContent.match(/[0-9,]+/)?.[0]?.replaceAll(',', '') || 0),
    time: document.querySelector('#liquidity-time')?.textContent || '',
    storage: document.querySelector('#liquidity-storage')?.textContent || '',
    replay: document.querySelector('#liquidity-replay')?.getAttribute('aria-pressed') || '',
    live: document.querySelector('#liquidity-live')?.getAttribute('aria-pressed') || '',
    series: document.querySelector('#market')?.value || ''
  };
}
const view = () => evaluate('(' + browserView.toString() + ')()');

async function seedBrowserRows() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('bitcornwisdom-liquidity-v1', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const now = Date.now(), tx = db.transaction('samples', 'readwrite');
  const store = tx.objectStore('samples');
  for (let i = 0; i < 104; i++) {
    const at = now - (105 - i) * 1100;
    const mid = 72000 + i * 8 + Math.sin(i * .17) * 35;
    store.put({
      version: 1, series: 'demo:spot:BTCUSDT', at, exchangeAt: null,
      source: 'demo-seeded', price: mid,
      levels: [[mid - 35, 1 + i / 30], [mid + 35, 3 + Math.sin(i / 7)]]
    });
  }
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return 104;
}

try {
  await until(async () => (await fetch('http://127.0.0.1:' + port)).ok, 8000);
  chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-background-networking', '--no-first-run', '--window-size=1440,900',
    '--remote-allow-origins=*', '--remote-debugging-port=' + debugPort,
    '--user-data-dir=' + profile,
    'http://127.0.0.1:' + port + '/?demo=1'
  ], { stdio: 'ignore' });
  const target = await until(async () => {
    const response = await fetch('http://127.0.0.1:' + debugPort + '/json/list', {
      signal: AbortSignal.timeout(1000)
    });
    const tabs = await response.json();
    return tabs.find((p) => p.type === 'page' && p.url.includes('127.0.0.1:' + port));
  }, 8000);
  socket = await new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error('DevTools socket failed'));
  });
  send = makeClient(socket);
  await send('Runtime.enable');
  await send('Page.enable');

  const initial = await until(async () => {
    const state = await view();
    return state.count >= 2 && state.storage.includes('IndexedDB active') ? state : null;
  });
  assert.equal(initial.live, 'true');
  assert.equal(initial.series, 'spot');
  assert.equal(await evaluate('(' + seedBrowserRows.toString() + ')()', true), 104);

  await send('Page.reload', { ignoreCache: true });
  const restored = await until(async () => {
    const state = await view();
    return state.count >= 104 && state.storage.includes('IndexedDB active') ? state : null;
  });
  assert.equal(restored.series, 'spot');
  assert.ok(restored.count >= 104);

  await evaluate("(() => { document.querySelector('#liquidity-replay').click(); const scrub = document.querySelector('#liquidity-scrubber'); scrub.value = '85'; scrub.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  const replay = await view();
  assert.equal(replay.replay, 'true');
  assert.equal(replay.live, 'false');
  assert.match(replay.time, /^Replay · /);
  assert.equal(await evaluate("document.querySelector('#liquidity-scrubber').value"), '85');
  assert.match(await evaluate("document.querySelector('.bottom-bar').textContent"), /v0\.5/);
  // Play at 16×, verify cursor progression, and pause at the chosen sample.
  await evaluate("(() => { const speed = document.querySelector('#liquidity-speed'); speed.value = '16'; speed.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('#liquidity-play').click(); return true; })()");
  await until(async () => Number(await evaluate("document.querySelector('#liquidity-scrubber').value")) > 85, 3000);
  await evaluate("document.querySelector('#liquidity-play').click()");
  assert.match(await evaluate("document.querySelector('#liquidity-play').textContent"), /Play/);
  // Let the scheduled Canvas requestAnimationFrame paint the requested replay cursor.
  await sleep(250);

  const screenshot = (await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false
  })).data;
  await writeFile('bitcorn-liquidity-replay.png', Buffer.from(screenshot, 'base64'));

  await evaluate("document.querySelector('#liquidity-live').click()");
  assert.equal((await view()).live, 'true');
  await evaluate("(() => { const s = document.querySelector('#market'); s.value = 'kraken'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
  const other = await until(async () => {
    const state = await view();
    return state.series === 'kraken' && state.storage.includes('IndexedDB active') ? state : null;
  });
  assert.ok(other.count < 20, 'Other venue must not inherit the BTCUSDT archive');
  await evaluate("(() => { const s = document.querySelector('#market'); s.value = 'spot'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
  const returned = await until(async () => {
    const state = await view();
    return state.series === 'spot' && state.count >= 104 ? state : null;
  });
  assert.ok(returned.count >= 104);

  await evaluate("(() => { window.confirm = () => true; document.querySelector('#liquidity-clear').click(); return true; })()");
  const erased = await until(async () => {
    const state = await view();
    return state.storage.includes('erased') ? state : null;
  });
  assert.ok(erased.count < returned.count, 'Erase must clear the loaded timeline');

  console.log('Liquidity IndexedDB smoke: PASS ' + JSON.stringify({
    initial: initial.count, restored: restored.count,
    replay: replay.time, isolated: other.count,
    afterErase: erased.count, screenshot: 'bitcorn-liquidity-replay.png'
  }));
} finally {
  if (socket) socket.close();
  if (chrome) chrome.kill();
  server.kill();
  await sleep(200);
  await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}
