import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INSTRUMENTS, resolveInstrument, feedPlan, safeRelayBase, normalizeCandle,
  normalizeHistory, normalizeEmbedConfig, feedProvenance
} from '../src/feed-policy.js';
import { relayUrls, parseRelayHistory, parseRelayMessage } from '../src/feed-adapters.js';
import { embedUrl } from '../src/embed-sdk.js';

const candle = (time, close = 101) =>
  ({ time, open: 100, high: 103, low: 99, close, volume: 5 });

test('BTC/USD spot has two independently identified same-quote venues', () => {
  const sources = feedPlan({ instrument: 'BTC-USD-SPOT', interval: '1m' });
  assert.deepEqual(sources.map(x => x.market), ['kraken','coinbase']);
  assert.ok(sources.every(x => x.symbol === 'BTCUSD' && x.instrument === 'BTC-USD-SPOT'));
  assert.deepEqual(feedPlan({
    instrument: 'BTC-USD-SPOT', preferred: 'coinbase'
  }).map(x=>x.market),['coinbase','kraken']);
  assert.deepEqual(feedPlan({
    instrument: 'ETH-USD-SPOT', preferred: 'kraken'
  }).map(x=>x.market), ['kraken', 'coinbase']);
  assert.deepEqual(resolveInstrument('BTC-USD-SPOT').intervals,['1m','5m','15m','1h','1d']);
});

test('quote currencies, spot, and perpetuals never silently become substitutes', () => {
  assert.deepEqual(feedPlan({instrument:'BTC-USDT-SPOT'}).map(x=>x.market),['spot']);
  assert.deepEqual(feedPlan({instrument:'BTC-USDT-PERP'}).map(x=>x.market),['futures']);
  assert.throws(()=>feedPlan({instrument:'BTC-USDT-SPOT',preferred:'kraken'}), /incompatible/);
  assert.throws(()=>feedPlan({instrument:'BTC-USD-SPOT',interval:'4h'}),/Interval unsupported/);
  assert.throws(()=>resolveInstrument('BTC/USDT'),/Unknown/);
  assert.ok(INSTRUMENTS['BTC-USD-SPOT'].product === 'spot');
});

test('relay URLs require explicit secure bases and are deduplicated', () => {
  assert.equal(safeRelayBase('https://data.example.org/fed/'),
    'https://data.example.org/fed');
  assert.throws(()=>safeRelayBase('http://untrusted.example/v1'), /HTTPS/);
  assert.throws(()=>safeRelayBase('http://localhost:8787'), /HTTPS/);
  assert.equal(safeRelayBase('http://localhost:8787', {allowLocal:true}),
    'http://localhost:8787');
  assert.throws(()=>safeRelayBase('https://key:pass@data.example.org'), /credentials/);
  assert.throws(()=>safeRelayBase('https://data.example.org/?key=secret'), /credentials/);
  assert.throws(()=>feedPlan({relays:['https://x.test','https://x.test']}), /Duplicate/);
  assert.throws(()=>feedPlan({relays:['https://a.test','https://b.test','https://c.test']}), /two/);
  const sources=feedPlan({relays:['https://relay.example.org/data']});
  assert.equal(sources.at(-1).kind,'relay');
  assert.equal(sources.at(-1).instrument,'BTC-USD-SPOT');
});

test('relay reads an explicit identity-bound history and typed streaming candles', () => {
  const source=feedPlan({ relays:['https://relay.example.org/data'] }).at(-1);
  const endpoints=relayUrls(source);
  assert.equal(new URL(endpoints.candles).pathname,'/data/v1/candles');
  assert.equal(new URL(endpoints.stream).protocol,'wss:');
  assert.equal(new URL(endpoints.stream).searchParams.get('instrument'),'BTC-USD-SPOT');
  const body={instrument:source.instrument,interval:'1m',candles:[candle(60000),candle(0)]};
  assert.deepEqual(parseRelayHistory(body,source).map(x=>x.time),[0,60000]);
  assert.throws(()=>parseRelayHistory({...body,instrument:'BTC-USDT-SPOT'},source),/mismatch/);
  const live=JSON.stringify({type:'candle',instrument:source.instrument,interval:'1m',
    candle:candle(120000)});
  assert.equal(parseRelayMessage(live,source).candle.close,101);
  assert.deepEqual(parseRelayMessage(JSON.stringify({
    type:'heartbeat',instrument:source.instrument,interval:'1m'
  }),source),{type:'heartbeat'});
  assert.throws(()=>parseRelayMessage(JSON.stringify({
    type:'candle',instrument:'BTC-USDT-SPOT',interval:'1m',candle:candle(120000)
  }),source),/mismatch/);
  assert.throws(()=>parseRelayMessage('x'.repeat(16385),source),/Oversized/);
});

test('relay candle constraints reject invented or invalid price geometry', () => {
  assert.deepEqual(normalizeCandle(candle(60000)),candle(60000));
  for(const bad of [
    {...candle(60000),close:104},
    {...candle(60000),volume:-1},
    {...candle(60000),time:NaN},
    {...candle(60000),low:0},
    {...candle(60000),high:Infinity}
  ]) assert.throws(()=>normalizeCandle(bad),/Invalid/);
  assert.deepEqual(normalizeHistory([candle(9000),candle(0),candle(9000)]).map(x=>x.time),
    [0,9000]);
  assert.throws(()=>normalizeHistory([]),/nonempty/);
  assert.throws(()=>normalizeHistory(Array.from({length:1201},(_,i)=>candle(i))),/bounded/);
});

test('embedding rejects unsafe origin and optional setting injection', () => {
  const parsed=normalizeEmbedConfig(new URLSearchParams(
    'instrument=BTC-USD-SPOT&interval=1m&preferred=coinbase&theme=verdigris&demo=1&parentOrigin=https%3A%2F%2Fhost.example'
  ));
  assert.equal(parsed.preferred,'coinbase');
  assert.equal(parsed.parentOrigin,'https://host.example');
  assert.equal(parsed.demo,true);
  assert.throws(()=>normalizeEmbedConfig('parentOrigin=https%3A%2F%2Fhost.example%2Fevil'),/exact/);
  assert.throws(()=>normalizeEmbedConfig('theme=%3Cscript%3E'),/theme/);
  const url=embedUrl({
    instrument:'BTC-USD-SPOT',interval:'5m',relays:['https://r.example']
  }, 'https://cdn.example/BitcornWisdom/src/embed-sdk.js','https://app.example');
  assert.equal(url.pathname,'/BitcornWisdom/embed.html');
  assert.equal(url.searchParams.get('parentOrigin'),'https://app.example');
  assert.deepEqual(url.searchParams.getAll('relay'),['https://r.example']);
  assert.throws(()=>embedUrl({embedUrl:'javascript:alert(1)'},
    'https://cdn.example/src/embed-sdk.js','https://host.example'),/HTTP/);
});

test('source event contains venue, feed instrument and failover reason', () => {
  const s=feedPlan({instrument:'BTC-USD-SPOT',preferred:'coinbase'})[0];
  assert.deepEqual(feedProvenance(s,{
    state:'live', reason:'missing-live-candles', receivedAt:123
  }),{
    sourceId:'coinbase:BTCUSD',instrument:'BTC-USD-SPOT',venue:'coinbase',
    symbol:'BTCUSD',kind:'exchange',state:'live',
    reason:'missing-live-candles',receivedAt:123
  });
});
