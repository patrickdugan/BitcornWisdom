// Real Chrome proof that the SDK can control two isolated iframes without a
// framework and cannot be fooled by a forged parent-window MessageEvent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port=5271, debugPort=9371;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,limit=18000){
  const end=Date.now()+limit;
  while(Date.now()<end){
    try{const value=await fn();if(value)return value;}catch{}
    await sleep(130);
  }
  throw Error('Embed Chrome state timed out');
}
function rpc(ws){
  let serial=0;
  const pending=new Map();
  ws.onmessage=({data})=>{
    const msg=JSON.parse(String(data)),entry=pending.get(msg.id);
    if(!entry)return;
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    if(msg.error)entry.reject(Error(JSON.stringify(msg.error)));
    else entry.resolve(msg.result);
  };
  return (method,params={})=>new Promise((resolve,reject)=>{
    const id=++serial;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},8000);
    pending.set(id,{resolve,reject,timer});
    ws.send(JSON.stringify({id,method,params}));
  });
}
async function connect(url){
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(url);
    ws.onopen=()=>resolve(ws);
    ws.onerror=()=>reject(Error('Chrome CDP handshake failed'));
  });
}

test('iframe SDK has two isolated charts, genuine source events and guarded commands',
  {timeout:100000},async()=>{
  const profile=await mkdtemp(join(tmpdir(),'bitcorn-embed-'));
  const server=spawn(process.execPath,['server.mjs'],{
    env:{...process.env,HOST:'127.0.0.1',PORT:String(port)},stdio:'ignore'
  });
  let chrome,ws;
  try{
    await until(async()=>(await fetch('http://127.0.0.1:'+port+'/embed-lab.html')).ok);
    chrome=spawn(process.env.CHROME_BIN||'google-chrome',[
      '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
      '--disable-background-networking','--no-first-run','--window-size=1600,1000',
      '--remote-debugging-port='+debugPort,'--remote-allow-origins=*',
      '--user-data-dir='+profile,
      'http://127.0.0.1:'+port+'/embed-lab.html?demo=1'
    ],{stdio:'ignore'});
    const target=await until(async()=>{
      const r=await fetch('http://127.0.0.1:'+debugPort+'/json/list');
      return (await r.json()).find(x=>x.type==='page'&&x.url.includes('embed-lab.html'));
    });
    ws=await connect(target.webSocketDebuggerUrl);
    const send=rpc(ws);
    await send('Runtime.enable');await send('Page.enable');
    const evaluate=async expression=>{
      const res=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
      if(res.exceptionDetails)throw Error(JSON.stringify(res.exceptionDetails));
      return res.result?.value;
    };
    await until(async()=>await evaluate(`(() => {
      const iframes=[...document.querySelectorAll('.lab-slot iframe')];
      return iframes.length===2 &&
        iframes.every(frame=>frame.contentDocument?.querySelector('#embed-chart')) &&
        document.querySelector('#lab-status')?.textContent.includes('2 EMBEDS READY');
    })()`));
    const before=await evaluate(`(() => {
      const frames=[...document.querySelectorAll('.lab-slot iframe')];
      return {
        sources:frames.map(x=>x.contentDocument.querySelector('#embed-source').textContent),
        states:frames.map(x=>x.contentDocument.querySelector('#embed-connection').textContent),
        price:frames.map(x=>x.contentDocument.querySelector('#embed-price').textContent),
        parentOrigin:frames[0].contentWindow.location.search.includes('parentOrigin=')
      };
    })()`);
    assert.deepEqual(before.sources,['SYNTHETIC DEMO','SYNTHETIC DEMO']);
    assert.ok(before.states.every(x=>x.includes('SYNTHETIC')));
    assert.ok(before.price.every(x=>/[0-9]/.test(x)));
    assert.equal(before.parentOrigin,true);

    await evaluate("window.bitcornDemo.left.setMarket('ETH-USD-SPOT','5m')");
    await until(async()=>await evaluate(`(() => {
      const f=document.querySelector('#lab-a iframe').contentDocument;
      return f.querySelector('#embed-instrument').value==='ETH-USD-SPOT' &&
        f.querySelector('#embed-interval').value==='5m';
    })()`));
    assert.equal(await evaluate("document.querySelector('#lab-b iframe').contentDocument.querySelector('#embed-instrument').value"),'ETH-USD-SPOT');
    assert.equal(await evaluate("document.querySelector('#lab-b iframe').contentDocument.querySelector('#embed-interval').value"),'1m');

    await evaluate("window.bitcornDemo.right.setTheme('verdigris')");
    await until(async()=>await evaluate("document.querySelector('#lab-b iframe').contentDocument.documentElement.dataset.theme==='verdigris'"));

    // A parent-level forged event cannot take over SDK source identity.
    const prior=await evaluate("JSON.stringify(window.bitcornDemo.left.getState())");
    await evaluate(`window.dispatchEvent(new MessageEvent('message',{
      origin:location.origin,source:window,
      data:{bitcorn:'v1',type:'event',event:'state',
        payload:{instrument:'BTC-USDT-PERP',price:99999999}}
    }))`);
    assert.equal(await evaluate("JSON.stringify(window.bitcornDemo.left.getState())"),prior);

    // A wrong quote/cross-market preferred venue is rejected by the child.
    await evaluate("window.bitcornDemo.left.setSelection({instrument:'BTC-USDT-SPOT',preferred:'kraken'})");
    await until(async()=>await evaluate("document.querySelector('#lab-status').textContent.includes('Feed notice:')"));
    assert.equal(await evaluate("document.querySelector('#lab-a iframe').contentDocument.querySelector('#embed-instrument').value"),'ETH-USD-SPOT');

    const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile('bitcorn-embed-lab.png',Buffer.from(screenshot.data,'base64'));
    console.log('Embed SDK two-frame interaction: PASS',JSON.stringify(before));
  }finally{
    ws?.close();chrome?.kill();server.kill();
    await sleep(200);
    await rm(profile,{recursive:true,force:true,maxRetries:2}).catch(()=>{});
  }
});
