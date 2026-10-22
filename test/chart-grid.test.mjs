import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRID_LAYOUTS, PANEL_DEFAULTS, GRID_INTERVAL_MS,
  normalizeGridLayout, normalizeGridPanes, normalizePane,
  timeAtIndex, indexAtTime, linkedViewForTarget
} from '../src/chart-grid-core.js';
import { CandleChart, coordinateMap } from '../src/chart.js';

test('grid layouts and multi-market preferences validate and persist three extra panes', () => {
  assert.deepEqual(GRID_LAYOUTS, [1, 2, 4]);
  assert.equal(normalizeGridLayout('2'), 2);
  assert.equal(normalizeGridLayout(4), 4);
  assert.equal(normalizeGridLayout('4.2'), 1);
  assert.equal(normalizeGridLayout(17), 1);
  assert.equal(normalizeGridPanes([]).length, 3);
  assert.equal(normalizeGridPanes([])[1].market, PANEL_DEFAULTS[1].market);
  assert.equal(normalizeGridPanes([{market:'spot',symbol:'ethusdt',interval:'1h'}])[0].symbol,'ETHUSDT');
  assert.equal(normalizePane({market:'kraken',symbol:'BTCUSD',interval:'3m'}).interval, '5m');
  assert.equal(normalizePane({market:'coinbase',symbol:'BTCUSD',interval:'1w'}).interval,'5m');
  assert.equal(normalizePane({market:'futures',symbol:'XBAD',interval:'15m',showEMA:'true'}).showEMA,false);
  assert.equal(normalizePane({market:'wrong',symbol:'../../etc',interval:'abc'}).market,'spot');
  assert.equal(normalizeGridPanes([null, null, null, {market:'spot',symbol:'BAD777'}]).length, 3);
});

test('relative candle indices and absolute times invert despite missing candle periods', () => {
  const candles = [
    {time:100_000},{time:160_000},{time:220_000},
    {time:520_000},{time:580_000}
  ];
  for (const index of [-2,0,0.25,1,1.5,2,2.3,3.5,4,5.2]) {
    const time = timeAtIndex(candles,index,60_000);
    const recovered = indexAtTime(candles,time,60_000);
    assert.ok(Math.abs(recovered-index) < 1e-9, 'round-trip index '+index);
  }
  assert.equal(timeAtIndex([],0,60_000),null);
  assert.equal(indexAtTime([],100_000,60_000),null);
  assert.equal(timeAtIndex(candles,2.5,60_000),370_000);
  assert.equal(indexAtTime(candles,370_000,60_000),2.5);
  assert.equal(GRID_INTERVAL_MS['1h'],3600000);
});

test('linked viewport preserves center for matching timeframes', () => {
  const candles=Array.from({length:360},(_,i)=>({time:1_700_000_000_000+i*300_000}));
  const frame={length:360,plotRight:1000,plotLeft:12,barWidth:8,offsetBars:30,gap:11};
  const map=coordinateMap({
    length:frame.length,plotRight:frame.plotRight,
    barWidth:frame.barWidth,offsetBars:frame.offsetBars,gap:frame.gap
  });
  const center=(frame.plotLeft+frame.plotRight)/2;
  const midIdx=map.index(center);
  const midTime=timeAtIndex(candles,midIdx,300_000);
  const view=linkedViewForTarget({
    targetCount:candles.length,targetIntervalMs:300_000,
    targetPlotWidth:frame.plotRight-frame.plotLeft,targetRight:frame.plotRight,
    centerX:center,targetCenterIndex:indexAtTime(candles,midTime,300_000),
    sourceSpanMs:(frame.plotRight-frame.plotLeft)/frame.barWidth*300_000
  });
  assert.ok(Math.abs(view.barWidth-frame.barWidth)<1e-9);
  assert.ok(Math.abs(view.offsetBars-frame.offsetBars)<1e-9);
});

test('linked target span adapts to different intervals and plot sizes', () => {
  const result=linkedViewForTarget({
    targetCount:200,targetIntervalMs:900_000,targetPlotWidth:780,
    targetRight:900,centerX:500,targetCenterIndex:150,
    sourceSpanMs:90_000_000
  });
  assert.ok(result.barWidth>=2 && result.barWidth<=45);
  assert.ok(result.offsetBars<=210 && result.offsetBars>=-60);
  const invalid=linkedViewForTarget({targetCount:0,targetIntervalMs:300000,targetPlotWidth:0,
    targetRight:100,centerX:50,targetCenterIndex:0,sourceSpanMs:0});
  assert.equal(invalid,null);
});

test('CandleChart viewport bridge publishes view without a recursion loop', () => {
  const chart=Object.create(CandleChart.prototype);
  chart.candles=Array.from({length:240},(_,i)=>({
    time:1_720_000_000_000 + i*300_000,
    open:100,high:101,low:99,close:100,volume:1
  }));
  chart.interval='5m';
  chart.gap=11;
  chart.barWidth=8;
  chart.offsetBars=0;
  chart.logarithmic=false;
  chart.showBB=false;
  chart.showRSI=false;
  chart.width=900;
  chart.height=650;
  chart.canvas={dataset:{}};
  chart.requestDraw=()=>{};
  let broadcasts=0, delivered;
  chart.onViewportChange=(_source,state)=>{broadcasts++;delivered=state;};
  chart.publishViewport();
  assert.equal(broadcasts,1);
  assert.ok(delivered.centerTime>1_720_000_000_000);
  assert.ok(delivered.spanMs>0);
  chart.setLinkedCursorTime(delivered.centerTime);
  assert.ok(Number(chart.canvas.dataset.linkedTime)>0);
  chart.setLinkedCursorTime(null);
  assert.ok(!Object.hasOwn(chart.canvas.dataset,'linkedTime'));
  assert.equal(chart.setLinkedViewport(delivered),true);
  assert.equal(broadcasts,1, 'receiver must not rebroadcast linked navigation');
  const position=chart.getViewportDescriptor();
  assert.ok(Math.abs(position.centerTime-delivered.centerTime)<300_000);
});
