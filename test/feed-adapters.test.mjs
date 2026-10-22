import test from 'node:test';
import assert from 'node:assert/strict';
import { openFeedSource } from '../src/feed-adapters.js';
import { feedPlan } from '../src/feed-policy.js';
import { FeedRouter } from '../src/feed-router.js';

const row=time=>({time,open:400,high:405,low:398,close:401,volume:7});
function mockSocket() {
  let closed=false;
  return {
    readyState:0,
    close() {closed=true;this.readyState=3;},
    get closed() {return closed;}
  };
}

test('opt-in relay loads bounded candles and consumes only matching WS frames',async()=>{
  const source=feedPlan({relays:['https://relay.test/market']}).at(-1);
  const ws=mockSocket(),state=[],candles=[],heartbeat=[];
  let historyAddress,streamAddress;
  const controller=new AbortController();
  const handle=await openFeedSource(source,{
    onHistory:rows=>candles.push(...rows),
    onStatus:value=>state.push(value),
    onCandle:value=>candles.push(value),
    onHeartbeat:()=>heartbeat.push('yes'),
    onError:error=>state.push('error:'+error.message)
  },controller.signal,{
    requester:async(url)=>{
      historyAddress=url;
      return {ok:true,json:async()=>({instrument:source.instrument,
        interval:source.interval,candles:[row(60000)]})};
    },
    socketFactory:url=>{streamAddress=url;return ws;}
  });
  assert.equal(new URL(historyAddress).pathname,'/market/v1/candles');
  assert.equal(new URL(streamAddress).protocol,'wss:');
  assert.deepEqual(candles.map(x=>x.time),[60000]);
  ws.readyState=1;ws.onopen();
  assert.ok(state.includes('live'));
  ws.onmessage({data:JSON.stringify({
    type:'heartbeat',instrument:source.instrument,interval:'1m'
  })});
  ws.onmessage({data:JSON.stringify({
    type:'candle',instrument:source.instrument,interval:'1m',candle:row(120000)
  })});
  assert.deepEqual(candles.map(x=>x.time),[60000,120000]);
  assert.equal(heartbeat.length,1);
  ws.onmessage({data:JSON.stringify({
    type:'candle',instrument:'BTC-USDT-SPOT',interval:'1m',candle:row(180000)
  })});
  assert.equal(candles.length,2);
  assert.ok(state.some(x=>x.includes('mismatch')));
  handle.close();
  assert.equal(ws.closed,true);
});

test('relay aborts history without publishing a connection',async()=>{
  const source=feedPlan({relays:['https://relay.test']}).at(-1);
  const controller=new AbortController();
  controller.abort();
  await assert.rejects(openFeedSource(source,{},controller.signal,{
    requester:async()=>{throw Error('Network must not be reached');}
  }),/Aborted/);
});

test('after both public REST sources fail, router can use a user-listed relay',async()=>{
  const sources=feedPlan({
    instrument:'BTC-USD-SPOT',relays:['https://relay.test']
  });
  const attempted=[],seen=[],errors=[];
  const relayWs=mockSocket();
  const router=new FeedRouter({
    sources,
    schedule:()=>77,cancel:()=>{},
    openSource:async(source,cb,signal)=>{
      attempted.push(source.market);
      return openFeedSource(source,cb,signal,{
        requester:async(url)=>{
          if(source.market!=='relay')return {ok:false,status:403};
          return {ok:true,json:async()=>({
            instrument:source.instrument,interval:source.interval,candles:[row(60000)]
          })};
        },
        socketFactory:()=>relayWs
      });
    },
    onHistory:(rows,source)=>seen.push({source:source.market,rows}),
    onError:(error,source)=>errors.push(source.market+':'+error.message)
  });
  assert.equal(await router.start(),true);
  relayWs.readyState=1;relayWs.onopen();
  assert.deepEqual(attempted,['kraken','coinbase','relay']);
  assert.equal(router.snapshot().source.kind,'relay');
  assert.equal(router.snapshot().state,'live');
  assert.equal(seen.length,1);
  assert.equal(seen[0].source,'relay');
  assert.ok(errors.length>=2);
  router.stop();
  assert.equal(relayWs.closed,true);
});
