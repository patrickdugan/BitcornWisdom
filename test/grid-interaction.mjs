// Interactive, offline Chrome validation of v0.9 workspace controls via CDP.
// Uses only Node's built-in WebSocket; no browser automation dependency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const serverPort = 5223, debugPort = 9354;
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, ms = 12000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch {}
    await pause(120);
  }
  throw new Error('Timed out waiting for interactive grid state');
}
function rpc(socket) {
  let seq = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(String(data));
    const req = pending.get(message.id);
    if (!req) return;
    pending.delete(message.id);
    clearTimeout(req.timer);
    if (message.error) req.reject(new Error(JSON.stringify(message.error)));
    else req.resolve(message.result);
  };
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: '+method)); }, 7000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error('Chrome CDP connection failed'));
  });
}

test('browser workspace saves, resizes, imports, rejects and restores', { timeout: 90000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'bitcorn-grid-test-'));
  const server = spawn(process.execPath, ['server.mjs'], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(serverPort) }, stdio: 'ignore'
  });
  let chrome, ws;
  try {
    await until(async () => (await fetch('http://127.0.0.1:'+serverPort+'/grid.html?demo=1')).ok);
    chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--disable-background-networking', '--no-first-run', '--window-size=1440,900',
      '--remote-debugging-port=' + debugPort, '--remote-allow-origins=*',
      '--user-data-dir=' + profile, 'http://127.0.0.1:'+serverPort+'/grid.html?demo=1'
    ], { stdio: 'ignore' });
    const page = await until(async () => {
      const response = await fetch('http://127.0.0.1:'+debugPort+'/json/list');
      const data = await response.json();
      return data.find((entry) => entry.type === 'page' && entry.url.includes('grid.html'));
    });
    ws = await connect(page.webSocketDebuggerUrl);
    const send = rpc(ws);
    await send('Runtime.enable');
    await send('Page.enable');
    async function evaluate(expression) {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
      return response.result?.value;
    }
    await until(async () => (await evaluate("document.querySelectorAll('.grid-cell-status b').length===2 && [...document.querySelectorAll('.grid-cell-status b')].every(x=>x.textContent==='SYNTHETIC DEMO')")));
    await evaluate(`(() => {
      const mode=document.querySelector('#grid-mode');mode.value='4';mode.dispatchEvent(new Event('change'));
      const sync=document.querySelector('#grid-sync-range');sync.checked=true;sync.dispatchEvent(new Event('change'));
    })()`);
    await until(async () => await evaluate("document.querySelectorAll('.grid-cell').length===4"));
    const position = await evaluate(`(() => {
      const r=document.querySelector('.grid-divider--col').getBoundingClientRect();
      // Avoid the horizontal divider crossing the vertical handle at its center.
      return {x:r.x+r.width/2,y:r.y+r.height/4};
    })()`);
    await send('Input.dispatchMouseEvent', { type:'mouseMoved', x:position.x, y:position.y, button:'none' });
    await send('Input.dispatchMouseEvent', { type:'mousePressed', x:position.x, y:position.y, button:'left', clickCount:1 });
    await send('Input.dispatchMouseEvent', { type:'mouseMoved', x:position.x+140, y:position.y, button:'left', buttons:1 });
    await send('Input.dispatchMouseEvent', { type:'mouseReleased', x:position.x+140, y:position.y, button:'left', clickCount:1 });
    const splitX = await evaluate("JSON.parse(localStorage.getItem('bitcornwisdom:grid:v2')).splitX");
    assert.ok(splitX > 55 && splitX < 72, 'drag should resize grid and persist ratio: '+splitX);
    const splitY = await evaluate(`(() => {
      const d=document.querySelector('.grid-divider--row');
      d.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
      return JSON.parse(localStorage.getItem('bitcornwisdom:grid:v2')).splitY;
    })()`);
    assert.equal(splitY,52.5);
    const saved = await evaluate(`(() => {
      document.querySelector('#grid-preset-name').value='Desk A';
      document.querySelector('#grid-save-preset').click();
      return JSON.parse(localStorage.getItem('bitcornwisdom:grid:presets:v1'));
    })()`);
    assert.equal(saved.length,1);
    assert.equal(saved[0].layout.mode,4);
    assert.equal(saved[0].layout.splitX,splitX);
    await evaluate(`(() => {
      const m=document.querySelector('#grid-mode');m.value='1';m.dispatchEvent(new Event('change'));
      const s=document.querySelector('#grid-presets');s.value='Desk A';
      document.querySelector('#grid-load-preset').click();
    })()`);
    assert.equal(await evaluate("document.querySelectorAll('.grid-cell').length"),4);
    assert.equal(await evaluate("document.querySelector('#grid-sync-range').checked"),true);
    await evaluate("document.querySelector('#grid-export').click()");
    assert.match(await evaluate("document.querySelector('#grid-layout-note').textContent"),/Exported active layout/);

    const portable = JSON.stringify({
      kind:'bitcornwisdom.grid.workspace',version:1,
      active:{mode:2,splitX:31,splitY:64,demo:true,syncRange:false},
      presets:[{name:'Imported desk',layout:{mode:4,splitX:63}}],
      theme:'synth'
    });
    async function importText(text) {
      const expression = `(() => {
        const transfer=new DataTransfer();
        transfer.items.add(new File([${JSON.stringify(text)}],'workspace.json',{type:'application/json'}));
        const input=document.querySelector('#grid-import-file');
        input.files=transfer.files;
        input.dispatchEvent(new Event('change'));
      })()`;
      await evaluate(expression);
    }
    await importText(portable);
    await until(async () => (await evaluate("document.querySelector('#grid-layout-note').textContent")).includes('Imported active layout'));
    assert.equal(await evaluate("document.querySelectorAll('.grid-cell').length"),2);
    assert.equal(await evaluate("document.documentElement.dataset.theme"),'synth');
    assert.deepEqual(await evaluate("JSON.parse(localStorage.getItem('bitcornwisdom:grid:presets:v1')).map(x=>x.name)"),['Imported desk']);
    const beforeBad = await evaluate("localStorage.getItem('bitcornwisdom:grid:v2')");
    await importText('{"kind":"invalid"}');
    await until(async () => (await evaluate("document.querySelector('#grid-layout-note').textContent")).includes('Import rejected'));
    assert.equal(await evaluate("localStorage.getItem('bitcornwisdom:grid:v2')"),beforeBad);

    const shot = await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile('bitcorn-grid-workspace.png', Buffer.from(shot.data,'base64'));
    await send('Page.reload',{ignoreCache:true});
    await until(async () => (await evaluate("document.querySelectorAll('.grid-cell').length")) === 2);
    assert.equal(await evaluate("document.documentElement.dataset.theme"),'synth');
    assert.equal(await evaluate("document.querySelector('#grid-presets option:last-child').textContent"),'Imported desk');
  } finally {
    ws?.close();
    chrome?.kill();
    server.kill();
    await pause(250);
    await rm(profile,{recursive:true,force:true,maxRetries:2}).catch(()=>{});
  }
});
