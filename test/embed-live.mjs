// Advisory public-feed QA for the standalone v0.11 embed, with a local or
// already-deployed HTTPS URL. Uses a real Chrome tab and exchange WS/REST.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port=5297,debugPort=9391;
const remoteUrl=process.env.BITCORN_EMBED_LIVE_URL||null;
const targetUrl=remoteUrl||'http://127.0.0.1:'+port+
  '/embed.html?instrument=BTC-USD-SPOT&preferred=kraken&interval=1m&demo=0';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,limit=15000){
  const end=Date.now()+limit;
  while(Date.now()<end){
    try{const v=await fn();if(v)return v;}catch{}
    await sleep(160);
  }
  throw Error('Timed out waiting for live embedded exchange data');
}
function client(socket){
  let serial=0;
  const pending=new Map();
  socket.onmessage=({data})=>{
    const msg=JSON.parse(String(data)),entry=pending.get(msg.id);
    if(!entry)return;
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    if(msg.error)entry.reject(Error(JSON.stringify(msg.error)));
    else entry.resolve(msg.result);
  };
  return(method,params={})=>new Promise((resolve,reject)=>{
    const id=++serial;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},7000);
    pending.set(id,{resolve,reject,timer});
    socket.send(JSON.stringify({id,method,params}));
  });
}

test('public Kraken or equivalent USD spot chart opens and displays live price', 
  {timeout:90000},async()=>{
  const profile=await mkdtemp(join(tmpdir(),'bitcorn-embed-live-'));
  const server=remoteUrl?null:spawn(process.execPath,['server.mjs'],{
    env:{...process.env,PORT:String(port),HOST:'127.0.0.1'},stdio:'ignore'
  });
  let chrome,socket;
  try{
    await until(async()=>(await fetch(targetUrl,{signal:AbortSignal.timeout(3000)})).ok,30000);
    chrome=spawn(process.env.CHROME_BIN||'google-chrome',[
      '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
      '--disable-background-networking','--no-first-run','--window-size=1120,750',
      '--remote-debugging-port='+debugPort,'--remote-allow-origins=*',
      '--user-data-dir='+profile,targetUrl
    ],{stdio:'ignore'});
    const page=await until(async()=>{
      const r=await fetch('http://127.0.0.1:'+debugPort+'/json/list');
      return (await r.json()).find(x=>x.type==='page'&&x.url===targetUrl);
    });
    socket=await new Promise((resolve,reject)=>{
      const ws=new WebSocket(page.webSocketDebuggerUrl);
      ws.onopen=()=>resolve(ws);
      ws.onerror=()=>reject(Error('Unable to open Chrome devtools'));
    });
    const send=client(socket);
    await send('Runtime.enable');await send('Page.enable');
    async function read(){
      const value=await send('Runtime.evaluate',{expression:`(() => ({
        instrument:document.querySelector('#embed-instrument')?.value,
        state:document.querySelector('#embed-connection')?.dataset.state,
        source:document.querySelector('#embed-source')?.textContent,
        price:document.querySelector('#embed-price')?.textContent,
        error:document.querySelector('#embed-error:not([hidden])')?.textContent || ''
      }))()`,returnByValue:true});
      return value.result?.value;
    }
    const state=await until(async()=>{
      const current=await read();
      if(current?.error)throw Error(current.error);
      return current?.state==='live'&&/^[0-9,.]+$/.test(current.price)?current:null;
    },30000).catch(async error=>{
      throw Error(error.message+'; last snapshot: '+JSON.stringify(await read().catch(()=>null)));
    });
    assert.equal(state.instrument,'BTC-USD-SPOT');
    assert.ok(['KRAKEN','COINBASE'].includes(state.source),
      'Exchange failover must retain an eligible USD spot venue');
    const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile('bitcorn-embed-live.png',Buffer.from(screenshot.data,'base64'));
    await writeFile('embed-live-report.json',JSON.stringify({
      testedAt:new Date().toISOString(),targetUrl,
      caveat:'Browser exchange access depends on network, region and venue availability',
      state
    },null,2)+'\n');
    console.log('Embedded public live feed: PASS '+JSON.stringify(state));
  }finally{
    socket?.close();
    chrome?.kill();
    server?.kill();
    await sleep(200);
    await rm(profile,{recursive:true,force:true,maxRetries:2}).catch(()=>{});
  }
});
