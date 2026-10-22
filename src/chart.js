import { clamp, formatCompact, formatPrice, upsertCandle, INTERVAL_MS } from './core.js';
import { ema, sma, rsi, bollingerBands } from './indicators.js';
import { CHART_COLORS } from './workspace.js';
import {
  MOTION_DURATION_MS, PULSE_DURATION_MS, motionProgress, interpolateCandle,
  prepareDepthProfile, sampleDepthProfile, interpolateDepthProfile, MarketRenderMetrics
} from './market-motion.js';
import {
  DRAWING_TOOLS, MAX_DRAWINGS, normalizeDrawings, makeDrawing,
  drawingShapes, pickDrawing, moveDrawing
} from './drawings.js';

export function viewRange(length, plotWidth, barWidth, offsetBars, gap = 11) {
  if (!length) return { start: 0, end: -1 };
  return {
    start: Math.max(0, Math.floor(length - 1 + gap - offsetBars - plotWidth / barWidth) - 1),
    end: Math.min(length - 1, Math.ceil(length - 1 + gap - offsetBars) + 1)
  };
}

export function coordinateMap({ length, plotRight, barWidth, offsetBars, gap = 11 }) {
  return {
    x: (index) => plotRight - (length - 1 - index + gap - offsetBars) * barWidth,
    index: (x) => length - 1 + gap - offsetBars - (plotRight - x) / barWidth
  };
}

export function createPriceScale(low, high, top, bottom, logarithmic = false) {
  if (!(high > low) || bottom <= top) throw new RangeError('Invalid price domain');
  const useLog = logarithmic && low > 0;
  const min = useLog ? Math.log(low) : low;
  const max = useLog ? Math.log(high) : high;
  const height = bottom - top;
  return {
    y(price) {
      const value = useLog ? Math.log(Math.max(Number.MIN_VALUE, price)) : price;
      return top + (max - value) / (max - min) * height;
    },
    price(y) {
      const value = max - (y - top) / height * (max - min);
      return useLog ? Math.exp(value) : value;
    }
  };
}

function tickStep(range, count) {
  const rough = range / count;
  const base = 10 ** Math.floor(Math.log10(Math.max(rough, 1e-10)));
  const unit = rough / base;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * base;
}

function timeLabel(ms, interval) {
  const date = new Date(ms);
  return interval === '1d' || interval === '3d' || interval === '1w' ?
    date.toISOString().slice(0, 10) :
    date.toISOString().slice(5, 16).replace('T', ' ') + 'Z';
}

/** Canvas2D OHLCV chart. One coordinate system is shared by candles, indicators, and drawings. */
export class CandleChart {
  constructor(canvas, { onDrawingsChange = () => {}, onHover = () => {}, onHistoryNeeded = null } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.candles = [];
    this.maxCandleBars = 8000;
    this.historyPending = false;
    this.historyExhausted = false;
    this.historyRetryAfter = 0;
    this.historyGeneration = 0;
    this.onHistoryNeeded = onHistoryNeeded;
    this.interval = '1m';
    this.barWidth = 8;
    this.offsetBars = 0;
    this.gap = 11;
    this.logarithmic = false;
    this.showEMA = true;
    this.showSMA = false;
    this.showBB = false;
    this.showRSI = false;
    this.theme = 'noir';
    this.cachedIndicators = null;
    this.drawings = [];
    this.undoStack = [];
    this.selectedIndex = null;
    this.drawingAnchor = null;
    this.tool = 'pan';
    this.pointer = null;
    this.externalCrossTime = null;
    this.drag = null;
    this.frame = null;
    this.raf = null;
    this.onDrawingsChange = onDrawingsChange;
    this.onHover = onHover;
    this.motionEnabled = true;
    this.depthProfileEnabled = false; // Enabled by the classic market desk.
    this.candleTween = null;
    this.priceTween = null;
    this.lastTrade = null;
    this.depthPrepared = null;
    this.depthTween = null;
    this.depthUpdatedAt = 0;
    this.marketMetrics = new MarketRenderMetrics();
    this.onPaint = null;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
    canvas.addEventListener('pointerdown', (event) => this.pointerDown(event));
    canvas.addEventListener('pointermove', (event) => this.pointerMove(event));
    canvas.addEventListener('pointerup', (event) => this.pointerUp(event));
    canvas.addEventListener('pointercancel', () => this.pointerCancel());
    canvas.addEventListener('pointerleave', () => { if (!this.drag) { this.pointer = null; this.requestDraw(); } });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('wheel', (event) => this.wheel(event), { passive: false });
    canvas.addEventListener('keydown', (event) => this.keyDown(event));
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.width = Math.max(200, rect.width);
    this.height = Math.max(200, rect.height);
    const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.requestDraw();
  }

  setCandles(candles, interval, reset = true) {
    this.candles = candles.slice(-this.maxCandleBars);
    this.cachedIndicators = null;
    this.interval = interval;
    this.candleTween = null;
    if (reset) {
      this.lastTrade = null;
      this.priceTween = null;
      this.offsetBars = 0;
      this.historyPending = false;
      this.historyExhausted = false;
      this.historyRetryAfter = 0;
      this.historyGeneration += 1;
    }
    this.requestDraw();
  }

  updateCandle(candle) {
    const now = performance.now();
    const oldLast = this.candles.at(-1);
    const painted = this.displayedCandle(now);
    const oldPrice = this.displayedPrice(now);
    const result = upsertCandle(this.candles, candle, this.maxCandleBars);
    if (result !== 'ignored') {
      if (this.canAnimate() && result === 'replaced' && oldLast?.time === candle.time)
        this.candleTween = { from: painted || oldLast, to: candle, started: now };
      else this.candleTween = null;
      if (!this.lastTrade || Date.now() - this.lastTrade.receivedAt > 1500) {
        if (this.canAnimate() && Number.isFinite(oldPrice) && oldPrice !== candle.close)
          this.priceTween = { from: oldPrice, to: candle.close, started: now };
        else this.priceTween = null;
      }
      this.marketMetrics.noteUpdate(now);
    }
    this.cachedIndicators = null;
    this.requestDraw();
    return result;
  }

  canAnimate() {
    return Boolean(this.motionEnabled) &&
      !(typeof document !== 'undefined' && document.hidden) &&
      !(typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  }

  displayedCandle(now = performance.now()) {
    const live = this.candleTween;
    if (!live || !this.canAnimate()) return this.candles.at(-1) || null;
    return interpolateCandle(live.from, live.to, motionProgress(live.started, now));
  }

  displayedPrice(now = performance.now()) {
    const live = this.priceTween;
    if (!live || !this.canAnimate()) return this.currentMarketPrice();
    const t = motionProgress(live.started, now);
    return live.from + (live.to - live.from) * t;
  }

  currentMarketPrice() {
    const last = this.candles.at(-1);
    return this.lastTrade && Date.now() - this.lastTrade.receivedAt < 1500 ?
      this.lastTrade.price : last?.close ?? null;
  }

  updateTrade(trade) {
    if (!Number.isFinite(trade?.price) || trade.price <= 0 ||
      !Number.isFinite(trade.time)) return;
    if (this.lastTrade && trade.time < this.lastTrade.time) return;
    const now = performance.now();
    const prior = this.displayedPrice(now);
    this.lastTrade = { price: trade.price, side: trade.side, time: trade.time,
      receivedAt: Date.now(), started: now };
    this.priceTween = this.canAnimate() && Number.isFinite(prior) ?
      { from: prior, to: trade.price, started: now } : null;
    this.marketMetrics.noteUpdate(now);
    this.requestDraw();
  }

  setDepthBook(book) {
    const prepared = prepareDepthProfile(book);
    if (!prepared) return;
    const now = performance.now();
    this.depthTween = this.canAnimate() && this.depthPrepared ?
      { from: this.depthPrepared, started: now } : null;
    this.depthPrepared = prepared;
    this.depthUpdatedAt = Date.now();
    this.marketMetrics.noteUpdate(now);
    this.requestDraw();
  }

  clearDepthBook() {
    this.depthPrepared = null;
    this.depthTween = null;
    this.depthUpdatedAt = 0;
    this.requestDraw();
  }

  profileActive() {
    return this.depthProfileEnabled && this.width >= 700;
  }

  motionActive(now) {
    if (!this.canAnimate()) return false;
    return Boolean(
      (this.candleTween && now - this.candleTween.started < MOTION_DURATION_MS) ||
      (this.priceTween && now - this.priceTween.started < MOTION_DURATION_MS) ||
      (this.depthTween && now - this.depthTween.started < MOTION_DURATION_MS) ||
      (this.lastTrade && now - this.lastTrade.started < PULSE_DURATION_MS)
    );
  }

  getMotionMetrics() { return this.marketMetrics.snapshot(); }

  /** Prepend older exchange bars without moving the current visible candles. */
  prependHistory(older) {
    if (!Array.isArray(older) || !older.length || !this.candles.length) return 0;
    const firstTime = this.candles[0].time;
    const unique = new Map();
    for (const candle of older) {
      if (candle.time < firstTime) unique.set(candle.time, candle);
    }
    const preceding = [...unique.values()].sort((a, b) => a.time - b.time);
    const room = Math.max(0, this.maxCandleBars - this.candles.length);
    if (!room || !preceding.length) return 0;
    const added = preceding.slice(-room);
    this.candles = [...added, ...this.candles];
    this.cachedIndicators = null;
    this.requestDraw();
    return added.length;
  }

  /** Refresh the newest bars while retaining previously paged older history. */
  replaceRecentHistory(recent) {
    const merged = new Map(this.candles.map((c) => [c.time, c]));
    for (const candle of recent) merged.set(candle.time, candle);
    this.candles = [...merged.values()].sort((a, b) => a.time - b.time)
      .slice(-this.maxCandleBars);
    this.cachedIndicators = null;
    this.requestDraw();
  }

  maybeNeedHistory() {
    if (!this.onHistoryNeeded || this.historyExhausted || this.historyPending ||
        Date.now() < this.historyRetryAfter || this.candles.length >= this.maxCandleBars ||
        this.candles.length === 0) return;
    if (this.computeFrame().start > 24) return;
    this.historyPending = true;
    const generation = this.historyGeneration;
    const request = this.onHistoryNeeded;
    Promise.resolve().then(() => request()).then((loaded) => {
      if (generation !== this.historyGeneration) return;
      if (loaded === false) this.historyExhausted = true;
      else if (loaded === null) this.historyRetryAfter = Date.now() + 10000;
    }).catch((error) => {
      if (generation !== this.historyGeneration) return;
      console.warn('Could not load older candles:', error);
      this.historyRetryAfter = Date.now() + 10000;
    }).finally(() => {
      if (generation === this.historyGeneration) this.historyPending = false;
    });
  }

  getIndicators() {
    if (this.cachedIndicators) return this.cachedIndicators;
    const candles = this.candles;
    return (this.cachedIndicators = {
      ema20: ema(candles, 20),
      sma50: sma(candles, 50),
      bollinger: bollingerBands(candles, 20, 2),
      rsi14: rsi(candles, 14)
    });
  }

  setOptions(options) {
    Object.assign(this, options);
    this.requestDraw();
  }

  setDrawings(lines) {
    this.drawings = normalizeDrawings(lines);
    this.undoStack = [];
    this.selectedIndex = null;
    this.drawingAnchor = null;
    this.requestDraw();
  }

  snapshotDrawings() {
    return this.drawings.map((d) => ({
      type: d.type, a: { ...d.a }, b: { ...d.b }
    }));
  }

  rememberDrawings(snapshot = this.snapshotDrawings()) {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > 50) this.undoStack.shift();
  }

  emitDrawings() {
    this.onDrawingsChange(this.drawings);
    this.requestDraw();
  }

  undoDrawing() {
    if (this.drawingAnchor) {
      this.drawingAnchor = null;
    } else if (this.undoStack.length) {
      this.drawings = this.undoStack.pop();
      this.selectedIndex = null;
      this.emitDrawings();
    } else {
      this.requestDraw();
    }
    this.requestDraw();
  }

  removeSelected() {
    if (!Number.isInteger(this.selectedIndex) ||
        this.selectedIndex < 0 || this.selectedIndex >= this.drawings.length) return false;
    this.rememberDrawings();
    this.drawings.splice(this.selectedIndex, 1);
    this.selectedIndex = null;
    this.emitDrawings();
    return true;
  }

  clearDrawings() {
    if (!this.drawings.length) return;
    this.rememberDrawings();
    this.drawings = [];
    this.selectedIndex = null;
    this.drawingAnchor = null;
    this.emitDrawings();
  }

  resetView() {
    this.offsetBars = 0;
    this.barWidth = 8;
    this.requestDraw();
  }

  setSyncedTime(time) {
    this.externalCrossTime = Number.isFinite(time) ? time : null;
    this.requestDraw();
  }

  setTool(tool) {
    if (!DRAWING_TOOLS.includes(tool)) throw new RangeError('Unknown drawing tool');
    this.tool = tool;
    this.drag = null;
    this.drawingAnchor = null;
    this.canvas.style.cursor = tool === 'pan' ? 'grab' :
      tool === 'select' ? 'default' : 'crosshair';
    this.requestDraw();
  }

  requestDraw() {
    if (this.raf !== null) return;
    this.raf = requestAnimationFrame((timestamp) => {
      this.raf = null;
      const started = performance.now();
      this.draw(timestamp);
      const ended = performance.now();
      this.marketMetrics.noteDraw(ended, ended - started);
      this.onPaint?.(this.marketMetrics.snapshot());
      if (this.motionActive(ended)) this.requestDraw();
    });
  }

  computeFrame() {
    const { width, height, candles, barWidth, offsetBars, gap } = this;
    const plotLeft = 12, plotRight = width - (this.profileActive() ? 190 : 80);
    const rsiVisible = this.showRSI && height >= 340;
    const rsiHeight = rsiVisible ? clamp(height * .16, 58, 104) : 0;
    const rsiTop = rsiVisible ? height - 28 - rsiHeight : null;
    const rsiBottom = rsiVisible ? height - 28 : null;
    const volumeBottom = rsiVisible ? rsiTop - 10 : height - 28;
    const volumeTop = volumeBottom - clamp(height * .14, 42, 91);
    const priceTop = 28, priceBottom = volumeTop - 15;
    const { start, end } = viewRange(candles.length, plotRight - plotLeft, barWidth, offsetBars, gap);
    const coordinates = coordinateMap({
      length: candles.length, plotRight, barWidth, offsetBars, gap
    });
    let low = Infinity, high = -Infinity, maxVolume = 1;
    for (let i = start; i <= end; i++) {
      low = Math.min(low, candles[i].low);
      high = Math.max(high, candles[i].high);
      maxVolume = Math.max(maxVolume, candles[i].volume);
    }
    if (!Number.isFinite(low)) { low = 1; high = 2; }
    if (this.showBB && candles.length >= 20) {
      const bands = this.getIndicators().bollinger;
      for (let i = start; i <= end; i++) {
        if (bands.lower[i] === null) continue;
        low = Math.min(low, bands.lower[i]);
        high = Math.max(high, bands.upper[i]);
      }
    }
    const spread = Math.max(high - low, high * .0001, .00000001);
    low = Math.max(0.000000001, low - spread * .085);
    high += spread * .085;
    const prices = createPriceScale(low, high, priceTop, priceBottom, this.logarithmic);
    return {
      plotLeft, plotRight, priceTop, priceBottom, volumeTop,
      volumeBottom, rsiTop, rsiBottom, start, end, coordinates, prices, low, high, maxVolume
    };
  }

  drawDepthProfile(frame, COLORS, now) {
    const { ctx, width: w } = this;
    const { plotRight: right, priceTop: top, priceBottom: bottom, prices } = frame;
    const railLeft = right + 77, railRight = w - 8;
    const railWidth = railRight - railLeft;
    if (!(railWidth > 10)) return;
    ctx.save();
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(railLeft, top, railWidth, bottom - top);
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath();
    ctx.moveTo(railLeft - 4, top);
    ctx.lineTo(railLeft - 4, bottom);
    ctx.stroke();
    ctx.font = '9px ui-monospace, Consolas, monospace';
    ctx.fillStyle = COLORS.labels;
    ctx.fillText('L2 DEPTH', railLeft + 3, top + 8);
    if (!this.depthPrepared) {
      ctx.fillText('WAITING', railLeft + 3, top + 24);
      ctx.restore();
      return;
    }

    // Map level prices through this exact chart's linear or logarithmic scale.
    const bins = 96;
    const pricesAtY = Array.from({ length: bins }, (_, i) =>
      prices.price(top + (bottom - top) * i / (bins - 1)));
    const target = sampleDepthProfile(this.depthPrepared, pricesAtY);
    const transition = this.depthTween;
    const from = transition && this.canAnimate() ?
      sampleDepthProfile(transition.from, pricesAtY) : null;
    const shape = interpolateDepthProfile(from, target,
      transition ? motionProgress(transition.started, now) : 1);
    const peak = Math.max(1e-10, ...shape.bids, ...shape.asks);
    ctx.save();
    ctx.beginPath();
    ctx.rect(railLeft, top + 18, railWidth, bottom - top - 18);
    ctx.clip();
    const paint = (values, color) => {
      let first = -1, last = -1;
      const coords = [];
      for (let i = 0; i < values.length; i++) {
        if (!(values[i] > 0)) continue;
        const y = top + (bottom - top) * i / (bins - 1);
        const x = railLeft + Math.sqrt(values[i] / peak) * (railWidth - 4);
        coords.push([x, y]);
        if (first === -1) first = i;
        last = i;
      }
      if (!coords.length) return;
      ctx.beginPath();
      ctx.moveTo(...coords[0]);
      for (const coord of coords.slice(1)) ctx.lineTo(...coord);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.65;
      ctx.stroke();
      ctx.lineTo(railLeft, coords.at(-1)[1]);
      ctx.lineTo(railLeft, coords[0][1]);
      ctx.closePath();
      ctx.globalAlpha = .12;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    paint(shape.asks, COLORS.down);
    paint(shape.bids, COLORS.up);
    ctx.restore();
    const stale = Date.now() - this.depthUpdatedAt > 10000;
    ctx.fillStyle = stale ? COLORS.down : COLORS.labels;
    ctx.fillText(stale ? 'STALE' : 'LIVE L2', railLeft + 3, bottom - 8);
    ctx.restore();
  }

  draw(now = performance.now()) {
    const { ctx, width: w, height: h, candles } = this;
    const movingCandle = this.displayedCandle(now);
    const COLORS = CHART_COLORS[this.theme] || CHART_COLORS.noir;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);
    const frame = this.computeFrame();
    this.frame = frame;
    const { plotLeft: left, plotRight: right, priceTop: top, priceBottom: bottom,
      volumeTop, volumeBottom, rsiTop, rsiBottom, start, end, coordinates, prices } = frame;

    ctx.font = '11px ui-monospace, SFMono-Regular, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.axis;
    ctx.fillRect(right + 1, 0, w - right, h);
    ctx.fillRect(0, h - 27, w, 27);

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = COLORS.labels;
    if (this.logarithmic && frame.low > 0) {
      for (let k = 0; k <= 5; k++) {
        const value = Math.exp(Math.log(frame.low) + (Math.log(frame.high) - Math.log(frame.low)) * k / 5);
        const y = Math.round(prices.y(value)) + .5;
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
        ctx.fillText(formatPrice(value), right + 7, y);
      }
    } else {
      const step = tickStep(frame.high - frame.low, 6);
      for (let value = Math.ceil(frame.low / step) * step; value <= frame.high; value += step) {
        const y = Math.round(prices.y(value)) + .5;
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
        ctx.fillText(formatPrice(value), right + 7, y);
      }
    }

    const intervalMs = INTERVAL_MS[this.interval] || 60_000;
    const spacing = Math.max(1, Math.round(105 / this.barWidth));
    for (let i = Math.max(start, 0); i <= end; i++) {
      const candle = candles[i];
      if (!candle || i % spacing !== 0) continue;
      const x = Math.round(coordinates.x(i)) + .5;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, volumeBottom); ctx.stroke();
      ctx.fillStyle = COLORS.labels;
      ctx.fillText(timeLabel(candle.time, this.interval), Math.min(x + 3, right - 105), h - 13);
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(left, top, right - left, volumeBottom - top);
    ctx.clip();
    for (let i = start; i <= end; i++) {
      const candle = i === candles.length - 1 ? movingCandle || candles[i] : candles[i];
      const x = coordinates.x(i);
      const color = candle.close >= candle.open ? COLORS.up : COLORS.down;
      const highY = prices.y(candle.high), lowY = prices.y(candle.low);
      const openY = prices.y(candle.open), closeY = prices.y(candle.close);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + .5, Math.round(highY) + .5);
      ctx.lineTo(Math.round(x) + .5, Math.round(lowY) + .5);
      ctx.stroke();
      const candleWidth = Math.max(1, Math.floor(this.barWidth * .72));
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(1, Math.abs(closeY - openY));
      ctx.fillStyle = candle.close >= candle.open ? COLORS.upBody : COLORS.downBody;
      ctx.fillRect(Math.round(x - candleWidth / 2), bodyTop, candleWidth, bodyHeight);
      ctx.strokeRect(Math.round(x - candleWidth / 2) + .5, Math.round(bodyTop) + .5,
        Math.max(0, candleWidth - 1), Math.max(0, Math.round(bodyHeight) - 1));

      const vheight = candle.volume / frame.maxVolume * (volumeBottom - volumeTop - 4);
      ctx.fillStyle = candle.close >= candle.open ? COLORS.volUp : COLORS.volDown;
      ctx.fillRect(Math.round(x - candleWidth / 2), volumeBottom - vheight, candleWidth, vheight);
    }

    const line = (values, color) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      let drawing = false;
      for (let i = start; i <= end; i++) {
        const value = values[i];
        if (value === null || value === undefined) { drawing = false; continue; }
        const x = coordinates.x(i), y = prices.y(value);
        if (!drawing) { ctx.moveTo(x, y); drawing = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    ctx.save();
    ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
    const indicators = (this.showEMA || this.showSMA || this.showBB || this.showRSI) ? this.getIndicators() : null;
    if (this.showBB && indicators) {
      ctx.globalAlpha = .85;
      line(indicators.bollinger.upper, COLORS.bb);
      line(indicators.bollinger.lower, COLORS.bb);
      ctx.globalAlpha = 1;
      line(indicators.bollinger.basis, COLORS.bb);
    }
    if (this.showEMA && indicators) line(indicators.ema20, COLORS.ema);
    if (this.showSMA && indicators) line(indicators.sma50, COLORS.sma);
    ctx.restore();

    const point = (p) => ({
      x: coordinates.x(this.timeToIndex(p.time)),
      y: prices.y(p.price)
    });
    const bounds = { left, right, top, bottom };
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.clip();
    const paintDrawing = (drawing, selected = false, preview = false) => {
      const shapes = drawingShapes(drawing, point, bounds);
      ctx.save();
      ctx.globalAlpha = preview ? .65 : 1;
      ctx.lineWidth = selected ? 1.8 : 1.35;
      ctx.strokeStyle = selected ? COLORS.last : COLORS.drawing;
      if (preview) ctx.setLineDash([5, 4]);
      const shownLabels = [];
      for (const shape of shapes.lines) {
        ctx.beginPath();
        ctx.moveTo(shape.x1, shape.y1);
        ctx.lineTo(shape.x2, shape.y2);
        ctx.stroke();
        if (shape.label) {
          const ty = Math.max(top + 10, Math.min(bottom - 10, shape.y1 - 7));
          // At low volatility seven fib labels can be <10 px apart.
          // Preserve all level lines, but suppress colliding labels.
          if (shownLabels.every((previous) => Math.abs(ty - previous) >= 15)) {
            shownLabels.push(ty);
            const caption = shape.label + '  ' + formatPrice(shape.price);
            ctx.font = '10px ui-monospace, monospace';
            ctx.textBaseline = 'middle';
            const width = ctx.measureText(caption).width;
            const tx = Math.max(left + 5, right - width - 12);
            ctx.setLineDash([]);
            ctx.fillStyle = COLORS.hoverBg;
            ctx.fillRect(tx - 4, ty - 8, width + 8, 16);
            ctx.fillStyle = selected ? COLORS.last : COLORS.drawing;
            ctx.fillText(caption, tx, ty);
          }
        }
      }
      if (selected || preview) {
        ctx.fillStyle = COLORS.bg;
        ctx.strokeStyle = COLORS.last;
        for (const anchor of shapes.handles) {
          ctx.beginPath();
          ctx.arc(anchor.x, anchor.y, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
    };
    for (let i = 0; i < this.drawings.length; i++)
      paintDrawing(this.drawings[i], i === this.selectedIndex);
    if (this.drawingAnchor && this.pointer) {
      const draft = makeDrawing(this.drawingAnchor.type, this.drawingAnchor.a,
        this.pointerToMarket(this.pointer.x, this.pointer.y));
      if (draft) paintDrawing(draft, false, true);
    }
    ctx.restore();
    ctx.restore();

    if (rsiTop !== null && indicators) {
      ctx.fillStyle = COLORS.axis;
      ctx.fillRect(left, rsiTop, right - left, rsiBottom - rsiTop);
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      for (const marker of [30, 50, 70]) {
        const y = rsiTop + (100 - marker) / 100 * (rsiBottom - rsiTop);
        ctx.beginPath();
        ctx.moveTo(left, Math.round(y) + .5);
        ctx.lineTo(right, Math.round(y) + .5);
        ctx.stroke();
        ctx.fillStyle = COLORS.labels;
        ctx.fillText(String(marker), right + 6, y);
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, rsiTop, right - left, rsiBottom - rsiTop);
      ctx.clip();
      ctx.beginPath();
      let pen = false;
      for (let i = start; i <= end; i++) {
        const value = indicators.rsi14[i];
        if (value == null) { pen = false; continue; }
        const x = coordinates.x(i);
        const y = rsiTop + (100 - value) / 100 * (rsiBottom - rsiTop);
        if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = COLORS.rsi;
      ctx.lineWidth = 1.65;
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = COLORS.labels;
      ctx.fillText('RSI 14', left + 6, rsiTop + 11);
    }

    if (this.profileActive()) this.drawDepthProfile(frame, COLORS, now);

    if (candles.length) {
      const last = candles[candles.length - 1];
      const rawPrice = this.currentMarketPrice() ?? last.close;
      const paintedPrice = this.displayedPrice(now) ?? rawPrice;
      const lastY = Math.max(top, Math.min(bottom, prices.y(paintedPrice)));
      ctx.strokeStyle = COLORS.last;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(left, lastY); ctx.lineTo(right, lastY); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COLORS.last;
      ctx.fillRect(right + 1, lastY - 10,
        this.profileActive() ? 73 : w - right - 2, 20);
      ctx.fillStyle = COLORS.lastText;
      ctx.fillText(formatPrice(rawPrice), right + 5, lastY);
      if (this.lastTrade && this.canAnimate()) {
        const elapsed = now - this.lastTrade.started;
        if (elapsed >= 0 && elapsed < PULSE_DURATION_MS) {
          ctx.beginPath();
          ctx.arc(right - 4, lastY, 2 + 5 * (1 - elapsed / PULSE_DURATION_MS), 0, Math.PI * 2);
          ctx.strokeStyle = this.lastTrade.side === 'sell' ? COLORS.down : COLORS.up;
          ctx.lineWidth = 1.8;
          ctx.stroke();
        }
      }
    }

    if (Number.isFinite(this.externalCrossTime) && !this.pointer) {
      const guideX = coordinates.x(this.timeToIndex(this.externalCrossTime));
      if (guideX >= left && guideX <= right) {
        ctx.save();
        ctx.strokeStyle = COLORS.cross;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(guideX, top);
        ctx.lineTo(guideX, volumeBottom);
        ctx.stroke();
        ctx.restore();
      }
    }
    if (this.pointer && this.pointer.x >= left && this.pointer.x <= right) {
      const { x, y } = this.pointer;
      ctx.strokeStyle = COLORS.cross;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(x + .5, top); ctx.lineTo(x + .5, volumeBottom); ctx.stroke();
      if (y <= bottom && y >= top) {
        ctx.beginPath(); ctx.moveTo(left, y + .5); ctx.lineTo(right, y + .5); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = COLORS.hoverBg; ctx.fillRect(right + 1, y - 10,
          this.profileActive() ? 73 : w - right - 2, 20);
        ctx.fillStyle = COLORS.hoverText; ctx.fillText(formatPrice(prices.price(y)), right + 5, y);
      }
      ctx.setLineDash([]);
      const index = Math.round(coordinates.index(x));
      const selected = candles[index];
      if (selected) {
        ctx.fillStyle = COLORS.hoverBg;
        ctx.fillRect(10, 2, Math.min(w - 92, 440), 22);
        ctx.fillStyle = COLORS.labels;
        ctx.fillText('O ' + formatPrice(selected.open) + '  H ' + formatPrice(selected.high) +
          '  L ' + formatPrice(selected.low) + '  C ' + formatPrice(selected.close) +
          '  V ' + formatCompact(selected.volume), 16, 13);
      }
    } else if (candles.length) {
      const selected = candles[candles.length - 1];
      ctx.fillStyle = COLORS.labels;
      ctx.fillText('O ' + formatPrice(selected.open) + '   H ' + formatPrice(selected.high) +
        '   L ' + formatPrice(selected.low) + '   C ' + formatPrice(selected.close) +
        '   V ' + formatCompact(selected.volume), 16, 13);
    }
    ctx.fillStyle = COLORS.labels;
    ctx.fillText('VOL (base)', left + 5, volumeTop + 10);
    ctx.fillText('UTC', right + 12, h - 13);
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath(); ctx.moveTo(left, volumeTop - 4); ctx.lineTo(right, volumeTop - 4); ctx.stroke();
  }

  timeToIndex(time) {
    const candles = this.candles;
    if (!candles.length) return 0;
    const first = candles[0].time;
    const last = candles[candles.length - 1].time;
    if (time < first) return (time - first) / (INTERVAL_MS[this.interval] || 60_000);
    if (time > last) return candles.length - 1 + (time - last) / (INTERVAL_MS[this.interval] || 60_000);
    let lo = 0, hi = candles.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >>> 1;
      if (candles[m].time < time) lo = m + 1; else hi = m;
    }
    return lo;
  }

  pointerToMarket(x, y) {
    const frame = this.frame || this.computeFrame();
    const index = Math.round(frame.coordinates.index(x));
    let time;
    if (index < 0) time = this.candles[0].time +
      index * (INTERVAL_MS[this.interval] || 60_000);
    else if (index >= this.candles.length) time = this.candles.at(-1).time +
      (index - this.candles.length + 1) * (INTERVAL_MS[this.interval] || 60_000);
    else time = this.candles[index].time;
    return { time, price: frame.prices.price(y) };
  }

  drawingFrame() {
    const frame = this.frame || this.computeFrame();
    return {
      point: (p) => ({
        x: frame.coordinates.x(this.timeToIndex(p.time)),
        y: frame.prices.y(p.price)
      }),
      bounds: {
        left: frame.plotLeft, right: frame.plotRight,
        top: frame.priceTop, bottom: frame.priceBottom
      }
    };
  }

  snapPoint(x, y, shiftKey = false) {
    const frame = this.frame || this.computeFrame();
    const point = this.pointerToMarket(x, y);
    if (!shiftKey) return point;
    const index = Math.round(frame.coordinates.index(x));
    const candle = this.candles[index];
    if (!candle) return point;
    const candidates = [candle.open, candle.high, candle.low, candle.close];
    const nearest = candidates.map((price) => ({
      price, delta: Math.abs(frame.prices.y(price) - y)
    })).sort((a,b) => a.delta - b.delta)[0];
    return nearest.delta <= 11 ? { time: candle.time, price: nearest.price } : point;
  }

  pointerDown(event) {
    if (event.button === 2) {
      this.drawingAnchor = null;
      this.drag = null;
      this.requestDraw();
      return;
    }
    if (event.button !== 0 || !this.candles.length) return;
    this.canvas.focus({ preventScroll: true });
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    this.pointer = { x, y };
    const { point, bounds } = this.drawingFrame();
    const priceArea = x >= bounds.left && x <= bounds.right &&
      y >= bounds.top && y <= bounds.bottom;
    if (!priceArea && this.tool !== 'pan') return;
    this.canvas.setPointerCapture?.(event.pointerId);
    const at = this.snapPoint(x, y, event.shiftKey);
    if (this.tool === 'select') {
      const hit = pickDrawing(this.drawings, point, bounds, x, y);
      this.selectedIndex = hit ? hit.index : null;
      if (hit) {
        this.drag = {
          kind: 'drawing', index: hit.index, part: hit.part,
          origin: at, original: { ...this.drawings[hit.index],
            a: { ...this.drawings[hit.index].a }, b: { ...this.drawings[hit.index].b } },
          before: this.snapshotDrawings(), dirty: false
        };
        this.canvas.style.cursor = 'grabbing';
      } else {
        this.drag = { kind: 'pan', startX: x, offset: this.offsetBars };
      }
    } else if (['line', 'fib'].includes(this.tool)) {
      if (this.drawingAnchor?.type === this.tool) {
        const drawing = makeDrawing(this.tool, this.drawingAnchor.a, at);
        if (drawing && this.drawings.length < MAX_DRAWINGS) {
          this.rememberDrawings();
          this.drawings.push(drawing);
          this.selectedIndex = this.drawings.length - 1;
          this.emitDrawings();
        }
        this.drawingAnchor = null;
      } else this.drawingAnchor = { type: this.tool, a: at };
    } else if (['horizontal', 'vertical'].includes(this.tool)) {
      const drawing = makeDrawing(this.tool, at);
      if (drawing && this.drawings.length < MAX_DRAWINGS) {
        this.rememberDrawings();
        this.drawings.push(drawing);
        this.selectedIndex = this.drawings.length - 1;
        this.emitDrawings();
      }
    } else {
      this.drag = { kind: 'pan', startX: x, offset: this.offsetBars };
      this.canvas.style.cursor = 'grabbing';
    }
    this.requestDraw();
  }

  pointerMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (this.drag?.kind === 'drawing') {
      const at = this.snapPoint(this.pointer.x, this.pointer.y, event.shiftKey);
      const { origin, original, part, index } = this.drag;
      let updated = null;
      if (part === 'body') {
        updated = moveDrawing(original, at.time - origin.time, at.price - origin.price);
      } else if (original.type === 'horizontal') {
        updated = makeDrawing('horizontal', { ...original.a, price: at.price });
      } else if (original.type === 'vertical') {
        updated = makeDrawing('vertical', { ...original.a, time: at.time });
      } else if (part === 'a') {
        updated = makeDrawing(original.type, at, original.b);
      } else if (part === 'b') {
        updated = makeDrawing(original.type, original.a, at);
      }
      if (updated) {
        this.drawings[index] = updated;
        this.drag.dirty = JSON.stringify(updated) !== JSON.stringify(original);
      }
    } else if (this.drag?.kind === 'pan') {
      const delta = (this.pointer.x - this.drag.startX) / this.barWidth;
      this.offsetBars = clamp(this.drag.offset + delta, -60, this.candles.length - 1 + this.gap);
    }
    const index = Math.round((this.frame || this.computeFrame()).coordinates.index(this.pointer.x));
    this.onHover(this.candles[index] || null);
    if (this.drag?.kind === 'pan') this.maybeNeedHistory();
    this.requestDraw();
  }

  pointerUp() {
    if (this.drag?.kind === 'drawing' && this.drag.dirty) {
      this.rememberDrawings(this.drag.before);
      this.emitDrawings();
    }
    this.drag = null;
    this.canvas.style.cursor = this.tool === 'pan' ? 'grab' :
      this.tool === 'select' ? 'default' : 'crosshair';
    this.requestDraw();
  }

  pointerCancel() {
    if (this.drag?.kind === 'drawing' && this.drag.dirty)
      this.drawings[this.drag.index] = this.drag.original;
    this.drag = null;
    this.pointer = null;
    this.canvas.style.cursor = this.tool === 'pan' ? 'grab' : 'crosshair';
    this.requestDraw();
  }

  wheel(event) {
    if (!this.candles.length) return;
    event.preventDefault();
    const bounds = this.canvas.getBoundingClientRect();
    const x = clamp(event.clientX - bounds.left, 12, this.computeFrame().plotRight);
    const oldIndex = this.computeFrame().coordinates.index(x);
    const direction = event.deltaY < 0 ? 1 : -1;
    this.barWidth = clamp(this.barWidth * (direction > 0 ? 1.16 : 1 / 1.16), 2, 45);
    const right = this.computeFrame().plotRight;
    this.offsetBars = clamp(this.candles.length - 1 + this.gap -
      oldIndex - (right - x) / this.barWidth, -60, this.candles.length - 1 + this.gap);
    this.maybeNeedHistory();
    this.requestDraw();
  }

  keyDown(event) {
    if (event.key === 'Escape') { this.drawingAnchor = null; this.selectedIndex = null; }
    else if (event.key === 'Delete' || event.key === 'Backspace') {
      this.removeSelected();
    }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      this.undoDrawing();
    } else if (event.key === 'ArrowLeft') {
      this.offsetBars = clamp(this.offsetBars + 4, -60, this.candles.length - 1 + this.gap);
    } else if (event.key === 'ArrowRight') {
      this.offsetBars = clamp(this.offsetBars - 4, -60, this.candles.length - 1 + this.gap);
    } else if (event.key === 'ArrowUp') {
      this.barWidth = clamp(this.barWidth * 1.15, 2, 45);
    } else if (event.key === 'ArrowDown') {
      this.barWidth = clamp(this.barWidth / 1.15, 2, 45);
    } else if (event.key === 'Home') {
      this.resetView();
    } else return;
    event.preventDefault();
    this.maybeNeedHistory();
    this.requestDraw();
  }

  destroy() {
    this.resizeObserver.disconnect();
    if (this.raf !== null) cancelAnimationFrame(this.raf);
  }
}
