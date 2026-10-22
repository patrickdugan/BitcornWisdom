import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

test('embed is iframe-capable while the classic desk remains frame-protected',
  {timeout:30000},async()=>{
  const port=5293;
  const server=spawn(process.execPath,['server.mjs'],{
    env:{...process.env,PORT:String(port),HOST:'127.0.0.1'},stdio:'ignore'
  });
  const base='http://127.0.0.1:'+port;
  try{
    let ready=false;
    for(let i=0;i<50;i++) {
      try {
        if((await fetch(base+'/embed.html')).ok){ready=true;break;}
      }catch{}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(ready,'Local static server must start');
    const embed=await fetch(base+'/embed.html');
    const page=await embed.text();
    const embedCsp=embed.headers.get('content-security-policy');
    assert.match(page,/src="\.\/src\/embed.js"/);
    assert.match(embedCsp,/connect-src 'self' https: wss:/);
    assert.doesNotMatch(embedCsp,/frame-ancestors/);

    const classic=await fetch(base+'/index.html');
    assert.match(classic.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    assert.doesNotMatch(classic.headers.get('content-security-policy'),/http:\/\/localhost:\*/);

    for(const asset of [
      '/embed.css','/embed-lab.html','/src/embed-sdk.js','/src/embed.js',
      '/src/feed-policy.js','/src/feed-router.js','/src/feed-adapters.js'
    ]) assert.equal((await fetch(base+asset)).status,200,asset+' must be available');
    for(const forbidden of [
      '/.git/config','/docs/EMBED.md','/test/feed-policy.test.mjs','/package.json'
    ]) assert.equal((await fetch(base+forbidden)).status,404,
      forbidden+' must not be published by the Node server');
  }finally{server.kill();}
});
