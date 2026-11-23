import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TICK_LERP_DURATION_MS,
  TICK_FLASH_DURATION_MS,
  CLEARED_LEVEL_TTL_MS,
  CandleTickAnimator
} from '../src/market-motion.js';
import {
  DEFAULT_CLEAR_TTL_MS,
  DEFAULT_SWEEP_RATIO,
  SequencedOrderBook,
  diffOrderBookLevels,
  OrderBookLevelTracker,
  annotateOrderBookLadder
} from '../src/orderbook.js';
import { CandleChart } from '../src/chart.js';
import { makeDemoCandles } from '../src/demo.js';

function createCanvasHarness(width = 960, height = 520) {
  const texts = [];
  const strokes = [];
  const fills = [];
  const lineToCoords = [];
  const noop = () => {};
  const ctx = {
    save: noop,
    restore: noop,
    setTransform: noop,
    clearRect: noop,
    rect: noop,
    clip: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: (x, y) => lineToCoords.push(['M', x, y]),
    lineTo: (x, y) => lineToCoords.push(['L', x, y]),
    arc: noop,
    fill: () => fills.push(ctx.fillStyle),
    stroke: () => strokes.push({ style: ctx.strokeStyle, width: ctx.lineWidth }),
    fillRect: (x, y, w, h) => fills.push({ style: ctx.fillStyle, x, y, w, h }),
    strokeRect: (x, y, w, h) => strokes.push({ style: ctx.strokeStyle, x, y, w, h }),
    setLineDash: noop,
    measureText: (txt) => ({ width: String(txt).length * 6.2 }),
    fillText: (txt, x, y) => texts.push({ text: String(txt), style: ctx.fillStyle, x, y }),
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'middle'
  };
  const canvas = {
    width: 0,
    height: 0,
    clientWidth: width,
    clientHeight: height,
    style: {},
    parentElement: {
      clientWidth: width,
      clientHeight: height,
      getBoundingClientRect: () => ({ left: 0, top: 0, width, height })
    },
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    addEventListener: noop,
    removeEventListener: noop
  };
  return { canvas, ctx, texts, strokes, fills, lineToCoords };
}

test('CandleTickAnimator smoothly interpolates close, high/low wicks, tick flash and volume pulse at 60fps', () => {
  const animator = new CandleTickAnimator();
  const baseCandle = { time: 60_000, open: 100_000, high: 100_120, low: 99_910, close: 100_020, volume: 12 };
  const snapshotCopy = structuredClone(baseCandle);

  animator.seed(baseCandle);
  const s0 = animator.sample(1000);
  assert.equal(s0.displayedClose, 100_020);
  assert.equal(s0.flashIntensity, 0);

  // Aggressive upward trade breaks above prior high -> displayedClose & displayedHigh lerp smoothly
  const tradeUp = { time: 60_250, price: 100_420, quantity: 2.5, side: 'buy' };
  const tradeCopy = structuredClone(tradeUp);
  animator.onTrade(tradeUp, baseCandle, 1000);

  let prevClose = 100_020;
  let prevHigh = 100_120;
  for (let frame = 1; frame <= 12; frame++) {
    const t = 1000 + frame * (1000 / 60);
    const s = animator.sample(t);
    assert.equal(s.direction, 'up');
    assert.equal(s.tickDelta, 400);
    assert.ok(s.displayedClose >= prevClose && s.displayedClose <= 100_420);
    assert.ok(s.displayedHigh >= prevHigh && s.displayedHigh >= s.displayedClose);
    assert.ok(s.displayedLow <= Math.min(s.displayedOpen, s.displayedClose));
    assert.ok(s.flashIntensity > 0 && s.flashIntensity <= 1);
    assert.ok(s.volumePulse > 0 && s.volumePulse <= 1);
    prevClose = s.displayedClose;
    prevHigh = s.displayedHigh;
  }

  // Exact convergence after lerp duration
  const settled = animator.sample(1000 + TICK_LERP_DURATION_MS);
  assert.equal(settled.displayedClose, 100_420);
  assert.equal(settled.displayedHigh, 100_420);
  assert.equal(settled.displayedLow, 99_910);
  assert.equal(settled.displayedVolume, 14.5);

  // Downward trade breaks below prior low -> downtick flash & wick extension
  animator.onTrade({ time: 60_500, price: 99_700, quantity: 1.5, side: 'sell' }, baseCandle, 2000);
  const midDown = animator.sample(2080);
  assert.equal(midDown.direction, 'down');
  assert.ok(midDown.displayedClose < 100_420 && midDown.displayedClose > 99_700);
  assert.ok(midDown.displayedLow < 99_910 && midDown.displayedLow <= midDown.displayedClose);

  // Flash & volume pulse decay cleanly to 0 after TICK_FLASH_DURATION_MS
  const postFlash = animator.sample(2000 + TICK_FLASH_DURATION_MS + 10);
  assert.equal(postFlash.flashIntensity, 0);
  assert.equal(postFlash.volumePulse, 0);
  assert.equal(animator.isActive(2000 + TICK_FLASH_DURATION_MS + 10), false);

  // Rolling into a new candle timestamp snaps open/high/low/close to the new bar cleanly
  const nextBar = { time: 120_000, open: 99_700, high: 99_760, low: 99_680, close: 99_740, volume: 0.8 };
  const rolled = animator.onCandle(nextBar, 3000);
  assert.equal(rolled.time, 120_000);
  assert.equal(rolled.displayedOpen, 99_700);
  assert.equal(rolled.displayedClose, 99_740);
  assert.deepEqual(baseCandle, snapshotCopy);
  assert.deepEqual(tradeUp, tradeCopy);
});

test('diffOrderBookLevels & OrderBookLevelTracker detect wiped and >=25% swept walls with 350-500ms TTL decay', () => {
  assert.ok(CLEARED_LEVEL_TTL_MS >= 350 && CLEARED_LEVEL_TTL_MS <= 500);
  assert.ok(DEFAULT_CLEAR_TTL_MS >= 350 && DEFAULT_CLEAR_TTL_MS <= 500);
  assert.equal(DEFAULT_SWEEP_RATIO, 0.25);

  const prev = {
    bids: [[99_990, 4.0], [99_980, 10.0], [99_970, 5.0]],
    asks: [[100_010, 6.0], [100_020, 8.0], [100_030, 4.0]]
  };
  const next = {
    // 99_990 completely wiped (-> 0), 99_980 swept by 30% (10 -> 7), 99_970 minor 10% trim ignored (5 -> 4.5)
    bids: [[99_980, 7.0], [99_970, 4.5], [99_965, 12.0]],
    // 100_010 swept by exactly 25% (6 -> 4.5), 100_020 wiped (-> 0), 100_030 stacked (+100%)
    asks: [[100_010, 4.5], [100_030, 8.0]]
  };

  const diff = diffOrderBookLevels(prev, next, { now: 5_000, ttlMs: 420 });
  const byKey = new Map(diff.clearedLevels.map((c) => [c.side + ':' + c.price, c]));

  assert.equal(byKey.get('bid:99990')?.kind, 'wiped');
  assert.equal(byKey.get('bid:99990')?.prevSize, 4.0);
  assert.equal(byKey.get('bid:99990')?.nextSize, 0);
  assert.equal(byKey.get('bid:99990')?.expiresAt, 5_420);

  assert.equal(byKey.get('bid:99980')?.kind, 'swept');
  assert.ok(Math.abs(byKey.get('bid:99980').clearedRatio - 0.3) < 1e-9);
  assert.equal(byKey.has('bid:99970'), false, '<25% reduction must not trigger false sweep');

  assert.equal(byKey.get('ask:100010')?.kind, 'swept');
  assert.ok(Math.abs(byKey.get('ask:100010').clearedRatio - 0.25) < 1e-9);
  assert.equal(byKey.get('ask:100020')?.kind, 'wiped');

  // Verify newly appeared and stacked walls
  assert.ok(diff.addedWalls.some((w) => w.side === 'bid' && w.price === 99_965 && w.kind === 'appeared'));
  assert.ok(diff.addedWalls.some((w) => w.side === 'ask' && w.price === 100_030 && w.kind === 'stacked'));

  // Stateful decay tracker progression
  const tracker = new OrderBookLevelTracker({ ttlMs: 400 });
  tracker.observe(prev, 10_000);
  const obs = tracker.observe(next, 10_100);
  assert.equal(obs.clearedLevels.length, 4);
  assert.equal(tracker.hasActive(10_250), true);

  const midDecay = tracker.activeAt(10_300); // halfway through 400ms TTL
  assert.equal(midDecay.length, 4);
  for (const entry of midDecay) {
    assert.ok(Math.abs(entry.decay - 0.5) < 1e-9);
  }

  // Ladder annotation preserves row count and marks wiped/swept/wall rows
  const ladderBids = annotateOrderBookLadder(next.bids, 'bid', midDecay, tracker.activeWallsAt(10_300), 4);
  assert.ok(ladderBids.some((r) => r.price === 99_990 && r.status === 'wiped' && r.ghostPct > 0));
  assert.ok(ladderBids.some((r) => r.price === 99_980 && r.status === 'swept' && r.ghostPct > 0));

  // Expired after TTL
  assert.equal(tracker.activeAt(10_501).length, 0);
  assert.equal(tracker.hasActive(10_501), false);
});

test('SequencedOrderBook emits structured clearedLevels on L2 delta wipe and >=25% sweep', () => {
  const clearedCallbacks = [];
  const book = new SequencedOrderBook('spot', {
    onLevelsCleared: (levels) => clearedCallbacks.push(levels)
  }, { clearTtlMs: 420 });

  book.installSnapshot({
    lastUpdateId: 10,
    bids: [['100000', '8'], ['99990', '4']],
    asks: [['100010', '10'], ['100020', '5']]
  });
  book.ingest({
    e: 'depthUpdate',
    U: 11,
    u: 12,
    E: 20_000,
    b: [['100000', '0']], // wiped
    a: [['100010', '6']]  // swept by 40%
  });

  assert.equal(clearedCallbacks.length, 1);
  assert.equal(clearedCallbacks[0].length, 2);
  assert.equal(clearedCallbacks[0][0].kind, 'wiped');
  assert.equal(clearedCallbacks[0][1].kind, 'swept');
  assert.equal(book.snapshot().clearedLevels.length, 2);
});

test('CandleChart renders OG MA(7)/MA(25)/MA(99), pixel-aligned wicks, tick flash, and L2 SWEPT rail', () => {
  const { canvas, texts, strokes, lineToCoords } = createCanvasHarness(960, 520);
  const chart = new CandleChart(canvas);
  chart.setOptions({ theme: 'og-wisdom', depthProfileEnabled: true, showMA: true });

  const candles = makeDemoCandles('5m', 120, 1_700_000_000_000, 100_000);
  chart.setCandles(candles, '5m', true);

  chart.setDepthBook({
    bids: [[99_980, 5], [99_950, 8], [99_900, 12]],
    asks: [[100_020, 6], [100_060, 9], [100_100, 14]]
  }, 1_000);

  // Eat the 100_020 ask wall and sweep 99_980 bid wall + fire live uptick trade
  chart.setDepthBook({
    bids: [[99_980, 2], [99_950, 8], [99_900, 12]],
    asks: [[100_060, 9], [100_100, 14]]
  }, 1_050);
  chart.updateTrade({ time: 1_700_000_000_200, price: 100_055, quantity: 1.8, side: 'buy' }, 1_060);

  texts.length = 0;
  strokes.length = 0;
  lineToCoords.length = 0;
  chart.draw(1_120);

  // Verify MA(7) #ff9900, MA(25) #cc66ff, MA(99) #4ea1ff lines & legend strip rendered
  assert.ok(texts.some((t) => t.text.startsWith('MA(7):') && t.style === '#ff9900'));
  assert.ok(texts.some((t) => t.text.startsWith('MA(25):') && t.style === '#cc66ff'));
  assert.ok(texts.some((t) => t.text.startsWith('MA(99):') && t.style === '#4ea1ff'));
  assert.ok(strokes.some((s) => s.style === '#ff9900'));
  assert.ok(strokes.some((s) => s.style === '#cc66ff'));
  assert.ok(strokes.some((s) => s.style === '#4ea1ff'));

  // Verify right-rail L2 clearing flash status & active cleared state
  assert.equal(chart.getActiveClearedLevels(1_120).length, 2);
  assert.ok(texts.some((t) => t.text === 'SWEPT L2' && t.style === '#ff9900'));

  // Verify crisp pixel-aligned .5 coordinates on wicks & grid lines
  assert.ok(lineToCoords.some(([, x, y]) => Math.abs((x % 1) - 0.5) < 1e-9 && Math.abs((y % 1) - 0.5) < 1e-9));

  chart.destroy();
});
