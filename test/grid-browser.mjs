// Isolated real Chromium grid integration smoke. No exchange network traffic.
// Tests four independent demo charts, time/cursor links, pane controls,
// layout teardown and localStorage restoration. Saves a screenshot artifact.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const port = 5219, debugPort = 9365;
const profile = await mkdtemp(join(tmpdir(), 'bitcorn-grid-'));
const server = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
  stdio: 'ignore'
});
let chrome, ws;
async function until(fn, duration = 10000) {
  const deadline = Date.now() + duration;
  while (Date.now() < deadline) {
    try { const result = await fn(); if (result) return result; }
    catch { /* browser starts asynchronously */ }
    await sleep(130);
  }
  throw new Error('Grid browser smoke timed out');
}
function cdpClient(socket) {
  let counter = 0;
  const outstanding = new Map();
  socket.onmessage = ({data}) => {
    const reply = JSON.parse(String(data));
    if (!outstanding.has(reply.id)) return;
    const pending = outstanding.get(reply.id);
    outstanding.delete(reply.id);
    clearTimeout(pending.timer);
    if (reply.error) pending.reject(new Error(JSON.stringify(reply.error)));
    else pending.resolve(reply.result);
  };
  socket.onclose = () => {
    for (const entry of outstanding.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('CDP disconnected'));
    }
    outstanding.clear();
  };
  return (method, params = {}) => new Promise((resolve,reject)=>{
    const id = ++counter;
    const timer = setTimeout(()=>{
      outstanding.delete(id);
      reject(new Error('CDP timeout: '+method));
    },8000);
    outstanding.set(id,{resolve,reject,timer});
    socket.send(JSON.stringify({id,method,params}));
  });
}
let send;
async function evaluate(expression) {
  const reply = await send('Runtime.evaluate', {
    expression, returnByValue: true
  });
  if (reply.exceptionDetails) throw new Error(
    reply.exceptionDetails.exception?.description ||
    reply.exceptionDetails.text || 'Browser runtime exception');
  return reply.result?.value;
}
function gridState() {
  const root=document.getElementById('chart-frame');
  const secondaries=[...root.querySelectorAll('.secondary-pane')];
  return {
    layout:document.getElementById('grid-layout').value,
    chartCount:root.querySelectorAll('canvas').length,
    panes:secondaries.map((pane)=>{
      const canvas=pane.querySelector('[data-role="canvas"]');
      return {
        market:canvas.dataset.market, symbol:canvas.dataset.symbol,
        interval:canvas.dataset.interval, status:canvas.dataset.feedStatus,
        candles:Number(canvas.dataset.candles||0),
        linkedTime:canvas.dataset.linkedTime||null,
        linkedView:canvas.dataset.linkedView||null,
        bb:pane.querySelector('[data-role="BB"]')?.getAttribute('aria-pressed')
      };
    }),
    main:document.getElementById('last-price').textContent,
    timeLink:document.getElementById('grid-link-time').checked,
    cursorLink:document.getElementById('grid-link-cursor').checked
  };
}
function selectLayout(n) {
  const select=document.getElementById('grid-layout');
  select.value=String(n);
  select.dispatchEvent(new Event('change',{bubbles:true}));
  return select.value;
}
function configurePane() {
  const pane=document.querySelector('.secondary-pane[data-pane="2"]');
  const market=pane.querySelector('[data-role="market"]');
  const symbol=pane.querySelector('[data-role="symbol"]');
  const interval=pane.querySelector('[data-role="interval"]');
  market.value='coinbase';
  market.dispatchEvent(new Event('change',{bubbles:true}));
  symbol.value='ETHUSD';
  interval.value='1h';
  pane.querySelector('[data-role="form"]').dispatchEvent(
    new Event('submit',{bubbles:true,cancelable:true}));
  pane.querySelector('[data-role="BB"]').click();
  return {
    market:pane.querySelector('[data-role="canvas"]').dataset.market,
    symbol:pane.querySelector('[data-role="canvas"]').dataset.symbol,
    interval:pane.querySelector('[data-role="canvas"]').dataset.interval
  };
}
function triggerLinks() {
  const primary=document.getElementById('candle-chart');
  primary.focus({preventScroll:true});
  primary.dispatchEvent(new KeyboardEvent('keydown',{
    key:'ArrowLeft',bubbles:true,cancelable:true
  }));
  const rect=primary.getBoundingClientRect();
  primary.dispatchEvent(new PointerEvent('pointermove',{
    bubbles:true,pointerId:1,pointerType:'mouse',
    clientX:rect.left+rect.width*.51,
    clientY:rect.top+Math.min(105,rect.height*.42)
  }));
  const target=document.querySelector('.secondary-pane [data-role="canvas"]');
  const state={view:target.dataset.linkedView||null,cursor:target.dataset.linkedTime||null};
  primary.dispatchEvent(new PointerEvent('pointerleave',{bubbles:true,pointerId:1}));
  state.cleared=!Object.hasOwn(target.dataset,'linkedTime');
  return state;
}

try {
  await until(async () => (await fetch('http://127.0.0.1:'+port+'/')).ok,8000);
  chrome=spawn(process.env.CHROME_BIN || 'google-chrome', [
    '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--disable-background-networking','--no-first-run',
    '--window-size=1440,900',
    '--remote-allow-origins=*','--remote-debugging-port='+debugPort,
    '--user-data-dir='+profile,
    'http://127.0.0.1:'+port+'/?demo=1'
  ],{stdio:'ignore'});
  const target=await until(async()=>{
    const response=await fetch('http://127.0.0.1:'+debugPort+'/json/list',{
      signal:AbortSignal.timeout(1000)
    });
    const data=await response.json();
    return data.find((x)=>x.type==='page'&&x.url.includes('127.0.0.1:'+port));
  },8000);
  ws=await new Promise((resolve,reject)=>{
    const socket=new WebSocket(target.webSocketDebuggerUrl);
    socket.onopen=()=>resolve(socket);
    socket.onerror=()=>reject(new Error('CDP WebSocket failed'));
  });
  send=cdpClient(ws);
  await send('Runtime.enable');
  await send('Page.enable');
  const initial=await until(async()=>{
    const state=await evaluate('('+gridState.toString()+')()');
    return state.main !== '—' ? state : null;
  });
  assert.equal(initial.layout,'1');
  assert.equal(initial.chartCount,1);

  assert.equal(await evaluate('('+selectLayout.toString()+')(4)'),'4');
  const four=await until(async()=>{
    const state=await evaluate('('+gridState.toString()+')()');
    return state.chartCount===4 && state.panes.every(x=>x.status==='demo'&&x.candles>=900) ? state : null;
  });
  assert.equal(four.panes.length,3);
  assert.equal(four.panes[0].symbol,'ETHUSDT');
  assert.equal(four.panes[1].market,'kraken');
  assert.ok(four.timeLink);
  assert.ok(four.cursorLink);

  const changed=await evaluate('('+configurePane.toString()+')()');
  assert.deepEqual(changed,{market:'coinbase',symbol:'ETHUSD',interval:'1h'});
  const custom=await until(async()=>{
    const state=await evaluate('('+gridState.toString()+')()');
    return state.panes[0].status==='demo' && state.panes[0].symbol==='ETHUSD'&&
      state.panes[0].candles>=900 ? state : null;
  });
  assert.equal(custom.panes[0].bb,'true');
  assert.equal(custom.panes[1].bb,'false');
  const linked=await evaluate('('+triggerLinks.toString()+')()');
  assert.ok(Number(linked.view)>0,'Time navigation did not link to secondary');
  assert.ok(Number(linked.cursor)>0,'Time crosshair did not link to secondary');
  assert.equal(linked.cleared,true);
  await sleep(280);

  const screenshot=(await send('Page.captureScreenshot',{
    format:'png',captureBeyondViewport:false
  })).data;
  await writeFile('bitcorn-multi-chart.png',Buffer.from(screenshot,'base64'));

  assert.equal(await evaluate('('+selectLayout.toString()+')(2)'),'2');
  assert.equal((await evaluate('('+gridState.toString()+')()')).chartCount,2);
  assert.equal(await evaluate('('+selectLayout.toString()+')(1)'),'1');
  assert.equal((await evaluate('('+gridState.toString()+')()')).chartCount,1);
  // Restore four panes before reload, validating local state rehydration.
  await evaluate('('+selectLayout.toString()+')(4)');
  await send('Page.reload',{ignoreCache:true});
  const persisted=await until(async()=>{
    const state=await evaluate('('+gridState.toString()+')()');
    return state.layout==='4' && state.chartCount===4 &&
      state.panes.every(x=>x.status==='demo') ? state : null;
  });
  assert.equal(persisted.panes[0].market,'coinbase');
  assert.equal(persisted.panes[0].symbol,'ETHUSD');
  assert.equal(persisted.panes[0].interval,'1h');
  assert.equal(persisted.panes[0].bb,'true');
  assert.equal(persisted.panes[1].market,'kraken');
  console.log('Chart grid browser: PASS '+JSON.stringify({
    initial:initial.chartCount,quad:four.chartCount,
    custom:changed,linked,persisted:persisted.panes.map(x=>x.symbol),
    screenshot:'bitcorn-multi-chart.png'
  }));
} finally {
  if(ws) ws.close();
  if(chrome) chrome.kill();
  server.kill();
  await sleep(230);
  await rm(profile,{recursive:true,force:true,maxRetries:3}).catch(()=>{});
}
