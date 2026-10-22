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
