import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID_MODES, GRID_DEFAULTS, normalizeGridCell, normalizeGridLayout,
  saveGridLayout, loadGridLayout, gridKey } from '../src/grid-model.js';

test('grid modes are one, two or four independently configured charts', () => {
 assert.deepEqual(GRID_MODES,[1,2,4]);
 for(const mode of GRID_MODES) {
   const result = normalizeGridLayout({mode});
   assert.equal(result.mode,mode);
   assert.equal(result.cells.length,4);
 }
 assert.equal(normalizeGridLayout({mode:3}).mode,2);
});

test('grid cell market symbols and intervals are constrained by adapter', () => {
 assert.deepEqual(normalizeGridCell({market:'coinbase',symbol:'ethusd',interval:'15m'}),
   {market:'coinbase',symbol:'ETHUSD',interval:'15m'});
 assert.equal(normalizeGridCell({market:'kraken',symbol:'BTCUSD',interval:'3m'}).interval,'5m');
 assert.deepEqual(normalizeGridCell({market:'invalid',symbol:'BTCUSD',interval:'5m'},1),GRID_DEFAULTS[1]);
 assert.deepEqual(normalizeGridCell({market:'spot',symbol:'../etc',interval:'5m'},2),GRID_DEFAULTS[2]);
 assert.equal(gridKey({market:'spot',symbol:'BTCUSDT',interval:'1h'}),'spot:BTCUSDT:1h');
});

test('grid layout persists round-trip, drops malformed entries and optional settings', () => {
 const memory=new Map();
 const storage={getItem:(key)=>memory.get(key)??null,setItem:(key,v)=>memory.set(key,v)};
 const saved=saveGridLayout(storage,{
   mode:4,demo:true,syncCrosshair:false,syncRange:true,
   cells:[
    {market:'spot',symbol:'BTCUSDT',interval:'1m'},
    {market:'futures',symbol:'ETHUSDT',interval:'5m'},
    {market:'kraken',symbol:'BTCUSD',interval:'1h'},
    {market:'coinbase',symbol:'ETHUSD',interval:'15m'}
   ]
 });
 assert.equal(saved.version,1);
 assert.deepEqual(loadGridLayout(storage),saved);
 memory.set('bitcornwisdom:grid:v1','{bad json');
 assert.equal(loadGridLayout(storage).mode,2);
 assert.equal(loadGridLayout(storage).syncCrosshair,true);
});


import { KrakenStream } from '../src/kraken.js';
import { CoinbaseStream } from '../src/coinbase.js';

function mockSocket() {
  const sent = [];
  const socket = { readyState: 1, sent,
    send(value) { sent.push(JSON.parse(value)); },
    close() { this.readyState = 3; } };
  return socket;
}
test('chart-only Kraken feed subscribes to OHLC without L2 book stream', () => {
 const ws = mockSocket();
 const stream = new KrakenStream('BTCUSD','5m',{},()=>ws,{chartOnly:true});
 stream.start(); ws.onopen();
 assert.deepEqual(ws.sent.map(x=>x.params.channel),['ohlc']);
 stream.close();
});
test('chart-only Coinbase feed avoids depth subscription while keeping trade candles', () => {
 const ws=mockSocket();
 const stream=new CoinbaseStream('BTCUSD','5m',{},()=>ws,{chartOnly:true});
 stream.start();ws.onopen();
 assert.deepEqual(ws.sent[0].channels,['matches','heartbeat']);
 stream.close();
});
test('classic adapters retain depth subscriptions by default', () => {
 const k=mockSocket(),c=mockSocket();
 const ks=new KrakenStream('BTCUSD','5m',{},()=>k);
 ks.start();k.onopen();
 assert.ok(k.sent.some(x=>x.params.channel==='book'));
 ks.close();
 const cs=new CoinbaseStream('BTCUSD','5m',{},()=>c);
 cs.start();c.onopen();
 assert.ok(c.sent[0].channels.includes('level2_batch'));
 cs.close();
});
