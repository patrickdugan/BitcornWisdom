import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedRouter } from '../src/feed-router.js';
import { feedPlan } from '../src/feed-policy.js';

const candle=(time=60000)=>({time,open:100,high:102,low:99,close:101,volume:5});
function clockHarness() {
  let now=0, tick=null, timerCleared=false;
  return {
    clock:()=>now,
    schedule(fn) {tick=fn;return 7;},
    cancel(id) {assert.equal(id,7);timerCleared=true;},
    advance(ms) {now+=ms;tick?.();},
    get timerCleared() {return timerCleared;}
  };
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('verified venue stays primary until an explicit failover trigger',async()=>{
  const time=clockHarness(),events=[],callbacks=new Map(),closed=[];
  const router=new FeedRouter({
    sources:feedPlan({instrument:'BTC-USD-SPOT'}),
    ...time, staleMs:30000,
    openSource:async(source,cb)=>{
      callbacks.set(source.market,cb);
      cb.onHistory([candle()]);
      cb.onStatus('live');
      return {close(){closed.push(source.market);}};
    },
    onSource:s=>events.push(s),
    onHistory:(rows,s)=>events.push({history:s.market,rows}),
    onCandle:(row,s)=>events.push({candle:s.market,price:row.close})
  });
  await router.start();
  assert.equal(router.snapshot().source.venue,'kraken');
  assert.equal(router.snapshot().state,'live');
  assert.equal(router.snapshot().eligibleSources,2);
  time.advance(5000);
  callbacks.get('kraken').onCandle(candle(120000));
  assert.equal(router.snapshot().source.venue,'kraken');
  time.advance(6000);
  assert.equal(router.snapshot().source.venue,'kraken');
  assert.deepEqual(closed,[]);
  router.stop();
  assert.deepEqual(closed,['kraken']);
  assert.equal(time.timerCleared,true);
});

test('stale primary fails over to same-quote Coinbase and ignores stale Kraken callbacks',async()=>{
  const time=clockHarness(),callbacks=new Map(),closed=[],observed=[];
  const router=new FeedRouter({
    sources:feedPlan({instrument:'BTC-USD-SPOT'}),
    ...time,staleMs:25000,
    openSource:async(source,cb)=>{
      callbacks.set(source.market,cb);
      cb.onHistory([candle()]);
      cb.onStatus('live');
      return {close:()=>closed.push(source.market)};
    },
    onSource:s=>observed.push({source:s.source?.venue,reason:s.reason}),
    onCandle:(row,source)=>observed.push({event:'tick',source:source.market})
  });
  await router.start();
  time.advance(26000);
  await flush();
  assert.equal(router.snapshot().source.venue,'coinbase');
  assert.ok(closed.includes('kraken'));
  callbacks.get('kraken').onCandle(candle(120000));
  assert.equal(observed.filter(x=>x.event==='tick').length,0);
  callbacks.get('coinbase').onCandle(candle(120000));
  assert.deepEqual(observed.filter(x=>x.event==='tick').map(x=>x.source),['coinbase']);
  assert.ok(observed.some(x=>x.source==='coinbase'&&x.reason==='missing-live-candles'));
  router.stop();
});

test('failed Kraken history triggers immediate Coinbase, a corrupt feed is rejected',async()=>{
  const errors=[],seen=[];
  const router=new FeedRouter({
    sources:feedPlan({instrument:'BTC-USD-SPOT'}),
    schedule:()=>9,cancel:()=>{},
    openSource:async(source,cb)=>{
      if(source.market==='kraken') {
        cb.onHistory([{...candle(),low:103}]);
        throw new Error('unexpected');
      }
      cb.onHistory([candle()]);
      cb.onStatus('live');
      return {close(){}};
    },
    onHistory:(rows,source)=>seen.push({market:source.market,rows}),
    onError:(error,source)=>errors.push(source.market+':'+error.message)
  });
  assert.equal(await router.start(),true);
  assert.equal(router.snapshot().source.venue,'coinbase');
  assert.equal(seen.length,1);
  assert.equal(seen[0].market,'coinbase');
  assert.ok(errors.some(x=>x.startsWith('kraken:')));
  router.stop();
});

test('disruption gets a grace window before switching providers',async()=>{
  const time=clockHarness(),callbacks=new Map();
  const router=new FeedRouter({
    sources:feedPlan({instrument:'ETH-USD-SPOT'}),...time,
    disruptedGraceMs:3000, staleMs:45000,
    openSource:async(source,cb)=>{
      callbacks.set(source.market,cb);
      cb.onStatus('live');
      return {close(){}};
    }
  });
  await router.start();
  callbacks.get('kraken').onStatus('reconnecting');
  assert.equal(router.snapshot().state,'disrupted');
  time.advance(2500);
  assert.equal(router.snapshot().source.venue,'kraken');
  time.advance(600);
  await flush();
  assert.equal(router.snapshot().source.venue,'coinbase');
  assert.equal(router.snapshot().reason,'socket-disconnected');
  router.stop();
});

test('all sources failing becomes unavailable, retry is bounded, and stop prevents retry',async()=>{
  const time=clockHarness();
  let attempts=0;
  const router=new FeedRouter({
    sources:feedPlan({instrument:'BTC-USD-SPOT'}),...time,retryMs:10000,
    openSource:async()=>{attempts++;throw Error('blocked in this region');}
  });
  assert.equal(await router.start(),false);
  assert.equal(router.snapshot().state,'unavailable');
  assert.equal(router.snapshot().source,null);
  assert.equal(attempts,2);
  time.advance(9000);
  assert.equal(attempts,2);
  time.advance(1100);
  await flush();
  assert.equal(attempts,4);
  router.stop();
  time.advance(30000);
  await flush();
  assert.equal(attempts,4);
});

test('cancelled pending REST fetch cannot publish a late candle or leak a socket',async()=>{
  const time=clockHarness();
  let signalRef, callbacksRef;
  const router=new FeedRouter({
    sources:feedPlan({instrument:'BTC-USDT-SPOT'}),...time,
    openSource:async(_source,cb,signal)=>{
      callbacksRef=cb;signalRef=signal;
      await new Promise((resolve,reject)=>{
        signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});
      });
    }
  });
  const start=router.start();
  await flush();
  router.stop();
  assert.equal(signalRef.aborted,true);
  await start;
  assert.equal(router.snapshot().state,'stopped');
  callbacksRef.onCandle(candle());
  assert.equal(router.snapshot().state,'stopped');
});

test('manual switching never reuses an incompatible quote',async()=>{
  const sources=feedPlan({instrument:'BTC-USDT-SPOT'});
  const router=new FeedRouter({
    sources, schedule:()=>1,cancel:()=>{},
    openSource:async(source,cb)=>{cb.onStatus('live');return {close(){}};}
  });
  await router.start();
  await router.failover('operator-request');
  assert.equal(router.snapshot().source.venue,'spot');
  assert.equal(router.snapshot().source.instrument,'BTC-USDT-SPOT');
  router.stop();
});

test('stale timestamps, future timestamps and old replay do not refresh feed health',async()=>{
  const current=Date.UTC(2026,9,22,21,0,0);
  let now=current, callbacks, accepted=0;
  const warnings=[];
  const router=new FeedRouter({
    sources:feedPlan({instrument:'BTC-USDT-SPOT'}),
    clock:()=>now,schedule:()=>42,cancel:()=>{},
    openSource:async(source,cb)=>{callbacks=cb;cb.onStatus('live');return{close(){}};},
    onCandle:()=>accepted++,
    onError:error=>warnings.push(error.message)
  });
  await router.start();
  callbacks.onCandle(candle(current-60000));
  assert.equal(accepted,1);
  callbacks.onCandle(candle(current-3600000));
  callbacks.onCandle(candle(current+3600000));
  assert.equal(accepted,1);
  assert.ok(warnings.some(x=>x.includes('Stale')));
  assert.ok(warnings.length>=2);
  now+=60000;
  callbacks.onCandle(candle(current));
  assert.equal(accepted,2);
  callbacks.onCandle(candle(current-240000));
  assert.equal(accepted,2);
  assert.ok(warnings.some(x=>x.includes('replay')));
  router.stop();
});
