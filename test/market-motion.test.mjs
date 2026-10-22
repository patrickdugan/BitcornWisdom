import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOTION_DURATION_MS, motionProgress, interpolateCandle, prepareDepthProfile,
  sampleDepthProfile, interpolateDepthProfile, MarketRenderMetrics
} from '../src/market-motion.js';

test('motion timing is bounded, monotonic and finishes exactly on a real update', () => {
  assert.equal(motionProgress(100, 99), 0);
  assert.equal(motionProgress(100, 100), 0);
  assert.equal(motionProgress(100, 100 + MOTION_DURATION_MS), 1);
  assert.equal(motionProgress(100, 100 + MOTION_DURATION_MS + 999), 1);
  const a=motionProgress(100,150), b=motionProgress(100,170);
  assert.ok(a > 0 && a < b && b < 1);
  assert.equal(motionProgress(100, 150, 0), 1);
});

test('visual interpolation keeps every candle valid and leaves immutable source untouched', () => {
  const start={time:3000,open:100,high:102,low:98,close:99,volume:1};
  const end={time:3000,open:100,high:106,low:97,close:105,volume:3};
  const before=structuredClone(start), after=structuredClone(end);
  for (let i=0;i<=20;i++) {
    const value=interpolateCandle(start,end,i/20);
    assert.equal(value.time,3000);
    assert.ok(value.low <= value.open && value.low <= value.close);
    assert.ok(value.high >= value.open && value.high >= value.close);
    assert.ok(value.volume>=0);
    assert.ok(value.close >= 99 && value.close <= 105);
  }
  assert.equal(interpolateCandle(start,end,0),start);
  assert.equal(interpolateCandle(start,end,1),end);
  assert.equal(interpolateCandle(start,{...end,time:6000},.2).time,6000);
  assert.deepEqual(start,before);
  assert.deepEqual(end,after);
});

test('depth shape uses cumulative verified quantities and keeps sides distinct', () => {
  const book={bids:[[98,4],[99,2]],asks:[[102,5],[101,3]],source:'test'};
  const saved=structuredClone(book);
  const prepared=prepareDepthProfile(book);
  assert.deepEqual(sampleDepthProfile(prepared,[103,102,101,100,99,98,97]),{
    bids:[0,0,0,0,2,6,6],
    asks:[8,8,3,0,0,0,0]
  });
  assert.deepEqual(book,saved);
});
test('depth combines duplicate levels, rejects invalid rows, and tolerates log-scale sampling', () => {
  const book={bids:[[99,1],[99,2],[98,-7],[97,NaN],['bad',2]],
    asks:[[101,1],[101,1],[102,2],[0,50]]};
  const prepared=prepareDepthProfile(book);
  assert.deepEqual(sampleDepthProfile(prepared,[103,101,100,99,98]),{
    bids:[0,0,0,3,3],asks:[4,2,0,0,0]
  });
  assert.equal(sampleDepthProfile(null,[100]),null);
  assert.equal(prepareDepthProfile({}),null);
  assert.equal(sampleDepthProfile(prepared,[102,101.2,100.8,99.9]).asks[1],2);
});
test('animated curves interpolate cumulative quantities without rewriting source L2', () => {
  const from={bids:[0,2,4],asks:[5,3,0]};
  const to={bids:[0,10,12],asks:[8,5,0]};
  assert.deepEqual(interpolateDepthProfile(from,to,.5),{
    bids:[0,6,8],asks:[6.5,4,0]
  });
  assert.deepEqual(interpolateDepthProfile(from,to,1),to);
  assert.equal(interpolateDepthProfile(null,null,.5),null);
  assert.deepEqual(interpolateDepthProfile({bids:[],asks:[]},to,.5),to);
});
test('market render meter measures update-to-draw and active FPS, excluding idle gaps', () => {
  const meter=new MarketRenderMetrics(4);
  assert.deepEqual(meter.snapshot(),{
    samples:0, updateToDrawMs:null, canvasDrawMs:null, activeFps:null
  });
  meter.noteUpdate(100);
  meter.noteDraw(116,2);
  meter.noteUpdate(120);
  meter.noteDraw(132,3);
  meter.noteDraw(1132,4); // idle gap is excluded from active FPS
  const snap=meter.snapshot();
  assert.equal(snap.samples,3);
  assert.equal(snap.updateToDrawMs,16);
  assert.equal(snap.canvasDrawMs,4);
  assert.equal(snap.activeFps,63);
  meter.noteUpdate(1200);
  meter.noteUpdate(1205); // coalesce updates: newest event is measured
  meter.noteDraw(1217,1);
  assert.equal(meter.snapshot().updateToDrawMs,16);
});
