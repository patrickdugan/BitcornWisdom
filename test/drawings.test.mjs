import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAWING_TOOLS, MAX_DRAWINGS, FIB_RATIOS,
  normalizeDrawing, normalizeDrawings, makeDrawing, fibonacciPrices,
  drawingShapes, distanceToSegment, hitDrawing, pickDrawing, moveDrawing
} from '../src/drawings.js';
import { CandleChart, coordinateMap, createPriceScale } from '../src/chart.js';

const a = { time: 120_000, price: 100 };
const b = { time: 300_000, price: 200 };
const frame = { left: 10, right: 900, top: 20, bottom: 460 };
const map = (p) => ({ x: p.time / 1000, y: 400 - p.price });

test('drawing schema accepts old {a,b} trend lines and canonicalizes types', () => {
  assert.deepEqual(normalizeDrawing({ a, b }), { type: 'line', a, b });
  assert.deepEqual(makeDrawing('horizontal', a), { type: 'horizontal', a, b: a });
  assert.deepEqual(makeDrawing('vertical', a), { type: 'vertical', a, b: a });
  assert.equal(normalizeDrawing({ type: 'script', a, b }), null);
  assert.equal(normalizeDrawing({ type: 'line', a: { ...a, price: NaN }, b }), null);
  assert.equal(normalizeDrawing({ type: 'line', a, b: { ...b, time: -1 } }), null);
  assert.equal(normalizeDrawing({ type: 'fib', a, b: null }), null);
  assert.ok(DRAWING_TOOLS.includes('select'));
});

test('malformed and overlong saved drawing arrays are ignored and bounded', () => {
  const entries = Array.from({ length: 300 }, () => ({ a, b }));
  entries.splice(5, 0, { type: 'bad', a, b });
  const cleaned = normalizeDrawings(entries);
  assert.equal(cleaned.length, MAX_DRAWINGS);
  assert.equal(cleaned[0].type, 'line');
  assert.deepEqual(normalizeDrawings({ evil: true }), []);
});

test('Fibonacci retracements preserve endpoints and seven standard levels', () => {
  const draw = makeDrawing('fib', a, b);
  const levels = fibonacciPrices(draw);
  assert.deepEqual(levels.map((item) => item.ratio), FIB_RATIOS);
  assert.equal(levels[0].price, a.price);
  assert.equal(levels.at(-1).price, b.price);
  assert.ok(Math.abs(levels[4].price - 161.8) < 1e-9);
  const reverse = fibonacciPrices(makeDrawing('fib', b, a));
  assert.equal(reverse[0].price, b.price);
  assert.equal(reverse.at(-1).price, a.price);
  assert.deepEqual(fibonacciPrices(makeDrawing('line', a, b)), []);
});

test('drawing geometry produces bounded hit-testable segments and handles', () => {
  const horizontal = drawingShapes(makeDrawing('horizontal', a), map, frame);
  assert.equal(horizontal.lines.length, 1);
  assert.deepEqual(horizontal.lines[0], { x1: 10, y1: 300, x2: 900, y2: 300 });
  assert.equal(horizontal.handles.length, 1);
  assert.equal(hitDrawing(makeDrawing('horizontal', a), map, frame, 700, 301)?.part, 'body');

  const vertical = drawingShapes(makeDrawing('vertical', a), map, frame);
  assert.deepEqual(vertical.lines[0], { x1: 120, y1: 20, x2: 120, y2: 460 });
  assert.equal(hitDrawing(makeDrawing('vertical', a), map, frame, 121, 380)?.part, 'body');

  const trend = drawingShapes(makeDrawing('line', a, b), map, frame);
  assert.equal(trend.lines.length, 1);
  assert.equal(trend.handles.length, 2);
  assert.equal(hitDrawing(makeDrawing('line', a, b), map, frame, 120, 300)?.part, 'a');
  assert.ok(distanceToSegment(1, 1, { x1: 100, y1: 0, x2: 200, y2: 0 }) > 90);
  assert.ok(distanceToSegment(101, 1, { x1: 100, y1: 0, x2: 200, y2: 0 }) < 2);
});

test('fib drawing renders seven finite horizontal rays with price labels', () => {
  const shapes = drawingShapes(makeDrawing('fib', a, b), map, frame);
  assert.equal(shapes.lines.length, 7);
  assert.equal(shapes.handles.length, 2);
  assert.ok(shapes.lines.every((shape) =>
    shape.x1 === 120 && shape.x2 === 900 && shape.y1 === shape.y2));
  assert.equal(shapes.lines[0].price, a.price);
  assert.equal(shapes.lines.at(-1).price, b.price);
  assert.match(shapes.lines[4].label, /61.8%/);
});

test('topmost overlap is selected and non-hit areas stay unselected', () => {
  const shapes = [makeDrawing('horizontal', a), makeDrawing('horizontal', a)];
  assert.equal(pickDrawing(shapes, map, frame, 700, 301)?.index, 1);
  assert.equal(pickDrawing(shapes, map, frame, 700, 250), null);
});

test('moving horizontal or vertical annotations changes only their semantic axis', () => {
  const h = moveDrawing(makeDrawing('horizontal', a), 60_000, 15);
  assert.equal(h.a.price, 115);
  assert.equal(h.a.time, a.time);
  const v = moveDrawing(makeDrawing('vertical', a), 60_000, 15);
  assert.equal(v.a.time, a.time + 60_000);
  assert.equal(v.a.price, 100);
  const trend = moveDrawing(makeDrawing('line', a, b), 60_000, 20);
  assert.equal(trend.a.time, 180_000);
  assert.equal(trend.b.time, 360_000);
  assert.equal(trend.a.price, 120);
  assert.equal(trend.b.price, 220);
  assert.equal(moveDrawing({ type: 'bad', a, b }, 0, 0), null);
});

function fakeChart() {
  const model = Object.create(CandleChart.prototype);
  model.canvas = {
    focus() {}, setPointerCapture() {},
    style: {}, getBoundingClientRect() { return { left: 0, top: 0 }; }
  };
  model.width = 960; model.height = 600;
  model.barWidth = 8; model.offsetBars = 0; model.gap = 11;
  model.interval = '1m'; model.tool = 'pan';
  model.historyGeneration = 0;
  model.historyPending = false;
  model.historyExhausted = false;
  model.historyRetryAfter = 0;
  model.candles = Array.from({ length: 60 }, (_, i) => {
    const time = i * 60_000;
    const close = 100 + Math.sin(i / 4) * 2;
    return { time, open: close, close, high: close + 2, low: close - 2, volume: 2 };
  });
  model.frame = {
    plotLeft: 12, plotRight: 880, priceTop: 28, priceBottom: 420,
    coordinates: coordinateMap({
      length: model.candles.length, plotRight: 880, barWidth: 8, offsetBars: 0, gap: 11
    }),
    prices: createPriceScale(80, 120, 28, 420)
  };
  model.drawings = []; model.undoStack = [];
  model.selectedIndex = null; model.drawingAnchor = null; model.drag = null;
  model.onHistoryNeeded = null;
  model.requestDraw = () => {};
  model.onHover = () => {};
  let writes = 0;
  model.onDrawingsChange = () => { writes++; };
  model.writes = () => writes;
  return model;
}

function click(model, x, y, shiftKey = false) {
  model.pointerDown({ button: 0, pointerId: 1, clientX: x, clientY: y, shiftKey });
  model.pointerUp();
}

test('chart tool clicks create semantic drawings, persist and undo them', () => {
  const chart = fakeChart();
  chart.setDrawings([{ a, b }]);
  assert.equal(chart.drawings.length, 1);
  chart.setTool('horizontal');
  click(chart, 580, 180);
  chart.setTool('vertical');
  click(chart, 620, 185);
  chart.setTool('fib');
  click(chart, 540, 140);
  click(chart, 710, 260);
  assert.deepEqual(chart.drawings.map((d) => d.type),
    ['line', 'horizontal', 'vertical', 'fib']);
  assert.equal(chart.writes(), 3);
  chart.undoDrawing();
  assert.deepEqual(chart.drawings.map((d) => d.type), ['line', 'horizontal', 'vertical']);
  chart.undoDrawing();
  assert.deepEqual(chart.drawings.map((d) => d.type), ['line', 'horizontal']);
  assert.throws(() => chart.setTool('dangerous'), RangeError);
});

test('select tool drags a horizontal level, persists edit and undo restores original', () => {
  const chart = fakeChart();
  chart.setTool('horizontal');
  click(chart, 540, 180);
  const before = chart.drawings[0].a.price;
  chart.setTool('select');
  chart.pointerDown({ button: 0, pointerId: 1, clientX: 700, clientY: 180 });
  chart.pointerMove({ clientX: 700, clientY: 205 });
  chart.pointerUp();
  assert.equal(chart.selectedIndex, 0);
  assert.ok(Math.abs(chart.drawings[0].a.price - before) > 1);
  const written = chart.writes();
  chart.undoDrawing();
  assert.equal(chart.drawings[0].a.price, before);
  assert.equal(chart.writes(), written + 1);
  assert.ok(chart.removeSelected() === false);
});

test('selected drawing deletion is undoable and Escape cancels unfinished fib', () => {
  const chart = fakeChart();
  chart.setTool('vertical');
  click(chart, 570, 170);
  chart.setTool('select');
  chart.pointerDown({ button: 0, pointerId: 1, clientX: 570, clientY: 170 });
  chart.pointerUp();
  assert.equal(chart.selectedIndex, 0);
  assert.equal(chart.removeSelected(), true);
  assert.equal(chart.drawings.length, 0);
  chart.undoDrawing();
  assert.equal(chart.drawings.length, 1);
  chart.setTool('fib');
  chart.pointerDown({ button: 0, pointerId: 1, clientX: 520, clientY: 180 });
  assert.ok(chart.drawingAnchor);
  let prevented = false;
  chart.keyDown({ key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(chart.drawingAnchor, null);
  assert.equal(prevented, true);
});
