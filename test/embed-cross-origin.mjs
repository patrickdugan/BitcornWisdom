// A real external HTTP app origin imports the public SDK module from the
// Bitcorn asset server, mounts a cross-origin iframe and issues SDK commands.
// This catches missing CORS and parent-origin failures hidden by same-origin QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cdnPort = 5318, appPort = 5319, debugPort = 9392;
const cdnOrigin = 'http://127.0.0.1:' + cdnPort;
const appOrigin = 'http://127.0.0.1:' + appPort;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(fn, deadlineMs = 18000) {
  const finish = Date.now() + deadlineMs;
  while (Date.now() < finish) {
    try { const result = await fn(); if (result) return result; } catch {}
    await sleep(130);
  }
  throw Error('Cross-origin chart handshake timed out');
}
function rpcClient(socket) {
  let n = 0;
  const requests = new Map();
  socket.onmessage = ({ data }) => {
    const msg = JSON.parse(String(data));
    const req = requests.get(msg.id);
    if (!req) return;
    requests.delete(msg.id);
    clearTimeout(req.timer);
    if (msg.error) req.reject(Error(JSON.stringify(msg.error)));
    else req.resolve(msg.result);
  };
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++n;
    const timer = setTimeout(() => {
      requests.delete(id); reject(Error('CDP request timeout: ' + method));
    }, 8000);
    requests.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function connectDebugger(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(Error('Could not connect Chrome DevTools'));
  });
}
function parentPage() {
  return `<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Independent demo host</title>
    <style>body{margin:0;background:#121821;color:white;font:14px sans-serif}
    #chart{height:580px;width:92%;margin:30px auto}</style>
    <script type="module" src="/host.js"></script>
  </head><body><h1>Independent host origin</h1><div id="chart"></div></body></html>`;
}

function hostModule() {
  return `
    import { mountBitcornChart } from '${cdnOrigin}/src/embed-sdk.js';
    window.demoEvents = [];
    window.widget = mountBitcornChart('#chart', {
      embedUrl:'${cdnOrigin}/embed.html', instrument:'BTC-USD-SPOT',
      preferred:'kraken', interval:'1m', demo:true, height:'580px'
    });
    for (const event of ['ready','state','source','candle','error','status']) {
      window.widget.on(event, payload => window.demoEvents.push({event,payload}));
    }
    window.widget.ready.then(() => {window.demoReady = true;},
      error => {window.demoError = error.message;});
  `;
}

test('cross-origin ESM SDK loads with CORS, controls isolated iframe and rejects forged messages',
  { timeout: 90000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'bitcorn-cross-origin-'));
  const cdn = spawn(process.execPath, ['server.mjs'], {
    env: { ...process.env, HOST:'127.0.0.1', PORT:String(cdnPort) }, stdio:'ignore'
  });
  const app = createServer((req, res) => {
    const isModule = req.url === '/host.js';
    res.writeHead(200, { 'Content-Type':isModule ?
      'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self' " + cdnOrigin +
        "; style-src 'self' 'unsafe-inline'; frame-src " + cdnOrigin + "; object-src 'none'"
    });
    res.end(isModule ? hostModule() : parentPage());
  });
  let chrome, socket;
  try {
    await new Promise(resolve => app.listen(appPort, '127.0.0.1', resolve));
    await until(async () => (await fetch(cdnOrigin + '/embed.html')).ok);
    const sdk = await fetch(cdnOrigin + '/src/embed-sdk.js');
    assert.equal(sdk.headers.get('access-control-allow-origin'), '*');
    assert.match(sdk.headers.get('cross-origin-resource-policy'), /cross-origin/);
    assert.equal(sdk.status, 200);

    chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
      '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
      '--disable-background-networking','--no-first-run','--window-size=1200,840',
      '--remote-debugging-port='+debugPort,'--remote-allow-origins=*',
      '--user-data-dir='+profile, appOrigin
    ], {stdio:'ignore'});
    const target = await until(async () => {
      const r = await fetch('http://127.0.0.1:' + debugPort + '/json/list');
      return (await r.json()).find(x => x.type === 'page' && x.url.startsWith(appOrigin));
    });
    socket = await connectDebugger(target.webSocketDebuggerUrl);
    const send = rpcClient(socket);
    await send('Runtime.enable');
    await send('Page.enable');
    async function evalJS(expression) {
      const result = await send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true
      });
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
      return result.result?.value;
    }
    await until(async () => await evalJS("window.demoReady === true"));
    const state = await evalJS(`(() => ({
      iframe: document.querySelector('#chart iframe')?.src,
      blockedChildRead: document.querySelector('#chart iframe')?.contentDocument === null,
      state: window.widget.getState(),
      ready: window.demoEvents.some(x => x.event === 'ready'),
      source: window.demoEvents.some(x => x.event === 'source'),
      errors: window.demoEvents.filter(x => x.event === 'error')
    }))()`);
    assert.ok(state.iframe.startsWith(cdnOrigin + '/embed.html'));
    assert.equal(new URL(state.iframe).searchParams.get('parentOrigin'), appOrigin);
    assert.equal(state.blockedChildRead, true, 'Iframe should remain cross-origin');
    assert.equal(state.ready, true);
    assert.equal(state.source, true);
    assert.equal(state.state.instrument, 'BTC-USD-SPOT');
    assert.equal(state.state.demo, true);
    assert.deepEqual(state.errors, []);

    await evalJS("window.widget.setMarket('ETH-USD-SPOT','5m')");
    await until(async () => await evalJS(`window.widget.getState()?.instrument ===
      'ETH-USD-SPOT' && window.widget.getState()?.interval === '5m'`));
    const known = await evalJS("JSON.stringify(window.widget.getState())");
    await evalJS(`window.dispatchEvent(new MessageEvent('message', {
      origin:'https://attacker.example', source:document.querySelector('#chart iframe').contentWindow,
      data:{bitcorn:'v1',type:'event',event:'state',
        payload:{instrument:'BTC-USDT-PERP',price:999999}}
    }))`);
    assert.equal(await evalJS("JSON.stringify(window.widget.getState())"), known);
    await evalJS(`window.dispatchEvent(new MessageEvent('message', {
      origin:location.origin, source:window,
      data:{bitcorn:'v1',type:'event',event:'state',
        payload:{instrument:'BTC-USDT-PERP',price:999999}}
    }))`);
    assert.equal(await evalJS("JSON.stringify(window.widget.getState())"), known);

    await evalJS("window.widget.setTheme('verdigris');window.widget.requestState()");
    await until(async () => await evalJS("window.widget.getState()?.theme === 'verdigris'"));
    const shot = await send('Page.captureScreenshot', {format:'png',captureBeyondViewport:false});
    await writeFile('bitcorn-cross-origin.png',Buffer.from(shot.data,'base64'));
    await evalJS("window.widget.destroy()");
    assert.equal(await evalJS("document.querySelectorAll('#chart iframe').length"),0);
    console.log('Third-party origin embed SDK/CORS: PASS');
  } finally {
    socket?.close();
    chrome?.kill();
    await new Promise(resolve => app.close(resolve));
    cdn.kill();
    await sleep(250);
    await rm(profile,{recursive:true,force:true,maxRetries:2}).catch(()=>{});
  }
});
