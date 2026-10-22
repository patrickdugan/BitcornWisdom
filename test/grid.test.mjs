import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID_MODES, GRID_DEFAULTS, normalizeGridCell, normalizeGridLayout,
  saveGridLayout, loadGridLayout, gridKey, normalizeSplit, normalizeGridPresets,
  saveGridPresets, loadGridPresets, exportGridWorkspace, parseGridWorkspace,
  GRID_PRESET_LIMIT, GRID_LAYOUT_KEY } from '../src/grid-model.js';

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
 assert.equal(saved.version,2);
 assert.deepEqual(loadGridLayout(storage),saved);
 memory.set(GRID_LAYOUT_KEY,'{bad json');
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

test('legacy v0.8 layout migrates to v0.9 without changing exchanges', () => {
  const memory = new Map();
  const storage = { getItem: k => memory.get(k) ?? null, setItem: (k,v) => memory.set(k,v) };
  storage.setItem('bitcornwisdom:grid:v1', JSON.stringify({
    version: 1, mode: 4, syncRange: true, cells: [
      { market: 'spot', symbol: 'BTCUSDT', interval: '1m' },
      { market: 'futures', symbol: 'ETHUSDT', interval: '5m' }
    ]
  }));
  const migrated = loadGridLayout(storage);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.mode, 4);
  assert.equal(migrated.splitX, 50);
  assert.equal(migrated.splitY, 50);
  assert.equal(migrated.cells[1].market, 'futures');
  saveGridLayout(storage, migrated);
  assert.equal(JSON.parse(storage.getItem(GRID_LAYOUT_KEY)).mode, 4);
});
test('splitters enforce finite values, pixel-safe bounds, and precision', () => {
  assert.equal(normalizeSplit(null), 50);
  assert.equal(normalizeSplit('junk'), 50);
  assert.equal(normalizeSplit(-500), 20);
  assert.equal(normalizeSplit(1000), 80);
  assert.equal(normalizeSplit(33.333), 33.3);
  const result = normalizeGridLayout({ splitX: 24.7, splitY: Infinity });
  assert.equal(result.splitX, 24.7);
  assert.equal(result.splitY, 50);
});
test('named presets are bounded, deduplicated and round-trip in storage', () => {
  const storageMap = new Map();
  const storage = {
    getItem: k => storageMap.get(k) ?? null,
    setItem: (k,v) => storageMap.set(k,v)
  };
  const presets = normalizeGridPresets([
    { name: '  Trend  ', layout: {mode:4,splitX:25} },
    { name: 'trend', layout: {mode:1} },
    { name: '', layout: {mode:2} },
    { name: 'Macro', layout: {mode:1} }
  ]);
  assert.deepEqual(presets.map(p => p.name), ['Trend','Macro']);
  assert.equal(presets[0].layout.splitX, 25);
  assert.deepEqual(loadGridPresets(storage), []);
  assert.deepEqual(saveGridPresets(storage, presets), loadGridPresets(storage));
  assert.equal(normalizeGridPresets(
    Array.from({length: GRID_PRESET_LIMIT + 12}, (_,i)=>({name:'P'+i,layout:{mode:1}}))
  ).length, GRID_PRESET_LIMIT);
});
test('portable workspace exports active layout, named layouts and chart theme', () => {
  const active = normalizeGridLayout({mode:4,splitX:32,splitY:66,demo:true});
  const presets = [{name:'My desk',layout:{mode:2,splitX:75}}];
  const text = exportGridWorkspace(active,presets,'verdigris');
  const result = parseGridWorkspace(text);
  assert.deepEqual(result.active, active);
  assert.equal(result.presets[0].name, 'My desk');
  assert.equal(result.presets[0].layout.splitX, 75);
  assert.equal(result.theme, 'verdigris');
  assert.equal(parseGridWorkspace(exportGridWorkspace({},[], 'evil')).theme, 'noir');
});
test('malformed or oversized workspace imports fail without state changes', () => {
  assert.throws(() => parseGridWorkspace('not json'), /invalid JSON/);
  assert.throws(() => parseGridWorkspace('{}'), /Unsupported/);
  assert.throws(() => parseGridWorkspace('x'.repeat(262145)), /256 KiB/);
  const template = JSON.parse(exportGridWorkspace({}, []));
  template.kind = 'untrusted';
  assert.throws(() => parseGridWorkspace(JSON.stringify(template)), /Unsupported/);
  template.kind = 'bitcornwisdom.grid.workspace';
  template.presets = Array.from({ length: GRID_PRESET_LIMIT + 1 }, (_,i)=>({
    name: String(i),layout:{mode:2}
  }));
  assert.throws(() => parseGridWorkspace(JSON.stringify(template)), /Unsupported/);
});
