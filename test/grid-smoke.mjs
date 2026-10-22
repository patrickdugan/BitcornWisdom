// Offline grid page hydration and screenshot. No exchange traffic.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
const port=5218;
const server=spawn(process.execPath,['server.mjs'],{
  env:{...process.env,PORT:String(port),HOST:'127.0.0.1'},stdio:'ignore'
});
try{
 let ready=false;
 for(let i=0;i<50;i++){
   try{if((await fetch('http://127.0.0.1:'+port+'/grid.html?demo=1')).ok){ready=true;break;}}catch{}
   await new Promise(r=>setTimeout(r,100));
 }
 assert.ok(ready,'grid server must start');
 for (const mode of [1,2,4]) {
 const chrome=spawnSync(process.env.CHROME_BIN||'google-chrome',[
   '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
   '--disable-background-networking','--no-first-run','--window-size=1440,900',
   '--virtual-time-budget=4200','--screenshot=bitcorn-grid-'+mode+'.png','--dump-dom',
   'http://127.0.0.1:'+port+'/grid.html?demo=1&mode='+mode
 ],{encoding:'utf8',timeout:22000,maxBuffer:8_000_000});
 if(chrome.error)throw chrome.error;
 assert.equal(chrome.status,0,chrome.stderr?.slice(-1200));
 assert.match(chrome.stdout,new RegExp('data-count="'+mode+'"'));
 assert.equal((chrome.stdout.match(/class="grid-cell"/g)||[]).length,mode);
 assert.equal((chrome.stdout.match(/SYNTHETIC DEMO/g)||[]).length,mode);
 assert.match(chrome.stdout,/BTC \/ USDT/);
 if(mode>1)assert.match(chrome.stdout,/ETH \/ USDT/);
 assert.match(chrome.stdout,new RegExp(mode+' / '+mode+' FEEDS ACTIVE'));
 }
 console.log('Multi-chart demo hydration: PASS (1, 2 and 4 independent cells)');
}finally{server.kill();}
