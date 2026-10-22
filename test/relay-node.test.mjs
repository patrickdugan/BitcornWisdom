import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRelayServer } from '../examples/relay-node.mjs';
import { feedPlan } from '../src/feed-policy.js';
import { parseRelayMessage, parseRelayHistory } from '../src/feed-adapters.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await delay(25);
  }
  throw new Error('Relay integration fixture timed out');
}

test('standalone relay forwards venue candles over CORS REST and real WebSocket frames',
  { timeout: 15000 }, async () => {
  const now = Date.UTC(2026, 9, 22, 15, 0, 0);
  const subscriptions = [];
  let upstream;
  const relay = makeRelayServer({
    clock: () => now,
    requester: async url => {
      const parsed = new URL(url);
      assert.equal(parsed.host, 'api.kraken.com');
      assert.equal(parsed.searchParams.get('pair'), 'XBTUSD');
      return { ok:true, json: async()=>({
        error:[], result:{
          XXBTZUSD:[[now / 1000,'100','103','99','101','100','4','3']],
          last:now / 1000
        }
      })};
    },
    upstreamFactory: () => {
      upstream = {
        close() { this.closed = true; },
        send(message) { subscriptions.push(JSON.parse(message)); }
      };
      setImmediate(() => upstream.onopen?.());
      return upstream;
    }
  });
  await new Promise(resolve => relay.server.listen(0, '127.0.0.1', resolve));
  const { port } = relay.server.address();
  const origin = 'http://127.0.0.1:' + port;
  const src = feedPlan({instrument:'BTC-USD-SPOT',interval:'1m',
    relays:['https://example-relay.test']}).at(-1);
  let ws;
  try {
    const health = await fetch(origin + '/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).source, 'kraken');
    const candlesResponse = await fetch(origin + '/v1/candles?instrument=BTC-USD-SPOT&interval=1m&limit=900');
    assert.equal(candlesResponse.status, 200);
    assert.equal(candlesResponse.headers.get('access-control-allow-origin'), '*');
    const candles = parseRelayHistory(await candlesResponse.json(), src);
    assert.equal(candles.length, 1);
    assert.equal(candles[0].time, now);
    assert.equal(candles[0].close, 101);
    assert.equal((await fetch(origin+'/v1/candles?instrument=BTC-USDT-PERP&interval=1m&limit=900')).status,400);
    assert.equal((await fetch(origin+'/not-found')).status,404);
    assert.equal((await fetch(origin+'/v1/candles',{method:'POST'})).status,405);

    ws = new WebSocket('ws://127.0.0.1:' + port +
      '/v1/stream?instrument=BTC-USD-SPOT&interval=1m');
    await until(() => ws.readyState === WebSocket.OPEN && subscriptions.length > 0);
    assert.equal(subscriptions[0].params.channel, 'ohlc');
    assert.deepEqual(subscriptions[0].params.symbol, ['BTC/USD']);
    assert.equal((await (await fetch(origin + '/health')).json()).activeClients, 1);

    const observed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Missing downstream OHLC frame')), 3000);
      ws.onmessage = ({ data }) => {
        clearTimeout(timer);
        resolve(parseRelayMessage(String(data), src));
      };
    });
    upstream.onmessage({data:JSON.stringify({
      channel:'ohlc',type:'update',data:[{
        symbol:'BTC/USD',interval_begin:new Date(now).toISOString(),
        open:'100',high:'104',low:'99',close:'102',volume:'5'
      }]
    })});
    const update = await observed;
    assert.equal(update.type, 'candle');
    assert.equal(update.candle.time, now);
    assert.equal(update.candle.close, 102);
    assert.equal(update.candle.volume, 5);
    ws.close();
    await until(()=>upstream.closed);
    assert.equal(relay.connections(),0);
  } finally {
    ws?.close();
    relay.closeAll();
    relay.server.closeAllConnections();
    await new Promise(resolve => relay.server.close(resolve));
  }
});
