// Browser-level market motion smoke using synthetic quotes and book snapshots.
// It checks actual rendered pixels, preserved book elements and draw latency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port=5239, debugPort=9381;
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn, timeoutMs=15000) {
  const end=Date.now()+timeoutMs;
  while(Date.now()<end) {
    try {const value=await fn();if(value)return value;} catch {}
    await sleep(140);
  }
  throw new Error('Market motion browser state timed out');
}
function remote(socket) {
  let serial=0;
  const requests=new Map();
  socket.onmessage=({data})=>{
    const payload=JSON.parse(String(data)),entry=requests.get(payload.id);
    if(!entry)return;
    requests.delete(payload.id);
    clearTimeout(entry.timer);
    if(payload.error)entry.reject(new Error(JSON.stringify(payload.error)));
    else entry.resolve(payload.result);
  };
  return (method,params={})=>new Promise((resolve,reject)=>{
    const id=++serial;
    const timer=setTimeout(()=>{
      requests.delete(id);
      reject(new Error('CDP request timed out: '+method));
    },7000);
    requests.set(id,{resolve,reject,timer});
    socket.send(JSON.stringify({id,method,params}));
  });
}
async function connect(url) {
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(url);
    ws.onopen=()=>resolve(ws);
    ws.onerror=()=>reject(new Error('Chrome CDP connection failed'));
  });
}

test('real Chrome renders moving candles and depth, keeps book rows, and reports draw latency',
  {timeout:90000},async()=>{
  const profile=await mkdtemp(join(tmpdir(),'bitcorn-market-motion-'));
  const server=spawn(process.execPath,['server.mjs'],{
    env:{...process.env,HOST:'127.0.0.1',PORT:String(port)},stdio:'ignore'
  });
  let chrome,ws;
  try {
    await until(async()=>(await fetch('http://127.0.0.1:'+port+'/index.html?demo=1')).ok);
    chrome=spawn(process.env.CHROME_BIN||'google-chrome',[
      '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
      '--disable-background-networking','--no-first-run','--window-size=1560,960',
      '--remote-debugging-port='+debugPort,'--remote-allow-origins=*',
      '--user-data-dir='+profile,
      'http://127.0.0.1:'+port+'/index.html?demo=1&market=spot&symbol=BTCUSDT&interval=1m'
    ],{stdio:'ignore'});
    const target=await until(async()=>{
      const res=await fetch('http://127.0.0.1:'+debugPort+'/json/list');
      return (await res.json()).find(x=>x.type==='page'&&x.url.includes('index.html'));
    });
    ws=await connect(target.webSocketDebuggerUrl);
    const send=remote(ws);
    await send('Runtime.enable');
    await send('Page.enable');
    const evalJS=async expression=>{
      const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
      if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);
      return result.result?.value;
    };
    await until(async()=>await evalJS(`(()=>
      document.querySelectorAll('.book-row.bid').length===10 &&
      document.querySelectorAll('.book-row.ask').length===10 &&
      document.querySelector('#connection-label')?.textContent==='OFFLINE DEMO'
    )()`));
    assert.equal(await evalJS("document.documentElement.dataset.motion"),'on');
    const before=await evalJS(`(() => {
      const row=document.querySelector('#bids .book-row');
      row.dataset.integrationTag='kept';
      return {price:row.children[1].textContent,bar:row.children[0].style.width};
    })()`);
    assert.ok(before.price.length>0);
    await sleep(1600);
    assert.equal(await evalJS("document.querySelector('#bids .book-row').dataset.integrationTag"),'kept');
    assert.match(await evalJS("document.querySelector('#book-status').textContent"),/Offline sample book/);
    assert.ok((await evalJS("document.querySelectorAll('#trades .trade-row').length"))>=2);
    const stats=await until(async()=>{
      const value=await evalJS("document.querySelector('#market-motion-stats').textContent");
      const match=/DRAW p95 ([0-9.]+) ms · UPDATE→DRAW p95 ([0-9.]+) ms · ACTIVE FPS ([0-9]+)/.exec(value);
      return match?{draw:Number(match[1]),latency:Number(match[2]),fps:Number(match[3])}:false;
    },10000);
    assert.ok(stats.draw>=0 && stats.draw<250,'canvas draw p95 too slow: '+stats.draw);
    assert.ok(stats.latency>=0 && stats.latency<500,'update-to-draw p95 too slow: '+stats.latency);
    assert.ok(stats.fps>=4,'active animation FPS too low: '+stats.fps);

    // Confirm the chart's dedicated L2 rail contains real bid/ask pigment.
    const pigment=await evalJS(`(() => {
      const canvas=document.querySelector('#candle-chart');
      const width=canvas.width,height=canvas.height;
      const x=Math.max(0,width-Math.round(115*(window.devicePixelRatio||1)));
      const w=Math.min(width-x,Math.round(110*(window.devicePixelRatio||1)));
      const pixels=canvas.getContext('2d').getImageData(x,0,w,height).data;
      let bid=0,ask=0;
      for(let i=0;i<pixels.length;i+=4) {
        const r=pixels[i],g=pixels[i+1],b=pixels[i+2];
        if(g>125 && g>r*1.35 && g>b*1.05)bid++;
        if(r>140 && r>g*1.3 && r>b*1.25)ask++;
      }
      return {bid,ask};
    })()`);
    assert.ok(pigment.bid>3 && pigment.ask>3,'expected green/red depth pigments: '+JSON.stringify(pigment));

    await evalJS("document.querySelector('#motion-toggle').click()");
    assert.equal(await evalJS("document.documentElement.dataset.motion"),'off');
    assert.equal(await evalJS("document.querySelector('#motion-toggle').getAttribute('aria-pressed')"),'false');
    assert.equal(await evalJS("JSON.parse(localStorage.getItem('bitcornwisdom:settings:v1')).motionEnabled"),false);
    await evalJS("document.querySelector('#motion-toggle').click()");
    assert.equal(await evalJS("document.documentElement.dataset.motion"),'on');
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile('bitcorn-market-motion.png',Buffer.from(shot.data,'base64'));
    console.log('Market motion Chrome rendering:',JSON.stringify({stats,pigment}));
  } finally {
    ws?.close();
    chrome?.kill();
    server.kill();
    await sleep(250);
    await rm(profile,{recursive:true,force:true,maxRetries:2}).catch(()=>{});
  }
});
