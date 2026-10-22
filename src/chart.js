import { clamp, formatCompact, formatPrice, upsertCandle, INTERVAL_MS } from './core.js';
import { ema, sma } from './indicators.js';

const COLORS = Object.freeze({
  up: '#85cfa5', down: '#e2737c', upBody: 'rgba(107,196,146,.23)',
  downBody: '#ae3d51', grid: '#25333f', labels: '#91a0ac', cross: '#86939e'
});

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
    this.onHistoryNeeded = onHistoryNeeded;
    this.interval = '1m';
    this.barWidth = 8;
    this.offsetBars = 0;
    this.gap = 11;
    this.logarithmic = false;
    this.showEMA = true;
    this.showSMA = false;
    this.drawings = [];
    this.drawingAnchor = null;
    this.tool = 'pan';
    this.pointer = null;
    this.drag = null;
    this.frame = null;
    this.raf = null;
    this.onDrawingsChange = onDrawingsChange;
    this.onHover = onHover;

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
    this.interval = interval;
    if (reset) {
      this.offsetBars = 0;
      this.historyPending = false;
      this.historyExhausted = false;
      this.historyRetryAfter = 0;
    }
    this.requestDraw();
  }

  updateCandle(candle) {
    const result = upsertCandle(this.candles, candle, this.maxCandleBars);
    this.requestDraw();
    return result;
  }

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
    this.requestDraw();
    return added.length;
  }

  /** Refresh the newest bars while retaining previously paged older history. */
  replaceRecentHistory(recent) {
    const merged = new Map(this.candles.map((c) => [c.time, c]));
    for (const candle of recent) merged.set(candle.time, candle);
    this.candles = [...merged.values()].sort((a, b) => a.time - b.time)
      .slice(-this.maxCandleBars);
    this.requestDraw();
  }

  maybeNeedHistory() {
    if (!this.onHistoryNeeded || this.historyExhausted || this.historyPending ||
        Date.now() < this.historyRetryAfter || this.candles.length >= this.maxCandleBars ||
        this.candles.length === 0) return;
    if (this.computeFrame().start > 24) return;
    this.historyPending = true;
    Promise.resolve().then(() => this.onHistoryNeeded()).then((loaded) => {
      if (loaded === false) this.historyExhausted = true;
      else if (loaded === null) this.historyRetryAfter = Date.now() + 10000;
    }).catch((error) => {
      console.warn('Could not load older candles:', error);
      this.historyRetryAfter = Date.now() + 10000;
    }).finally(() => { this.historyPending = false; });
  }

  setOptions(options) {
    Object.assign(this, options);
    this.requestDraw();
  }

  setDrawings(lines) {
    this.drawings = Array.isArray(lines) ? lines.filter((d) =>
      Number.isFinite(d?.a?.time) && Number.isFinite(d?.a?.price) &&
      Number.isFinite(d?.b?.time) && Number.isFinite(d?.b?.price)) : [];
    this.drawingAnchor = null;
    this.requestDraw();
  }

  undoDrawing() {
    if (this.drawingAnchor) this.drawingAnchor = null;
    else this.drawings.pop();
    this.onDrawingsChange(this.drawings);
    this.requestDraw();
  }

  resetView() {
    this.offsetBars = 0;
    this.barWidth = 8;
    this.requestDraw();
  }

  setTool(tool) {
    this.tool = tool;
    this.drawingAnchor = null;
    this.canvas.style.cursor = tool === 'line' ? 'crosshair' : 'grab';
    this.requestDraw();
  }

  requestDraw() {
    if (this.raf !== null) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      this.draw();
    });
  }

  computeFrame() {
    const { width, height, candles, barWidth, offsetBars, gap } = this;
    const plotLeft = 12, plotRight = width - 80;
    const volumeBottom = height - 28;
    const volumeTop = height - clamp(height * .18, 45, 108);
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
    const spread = Math.max(high - low, high * .0001, .00000001);
    low = Math.max(0.000000001, low - spread * .085);
    high += spread * .085;
    const prices = createPriceScale(low, high, priceTop, priceBottom, this.logarithmic);
    return {
      plotLeft, plotRight, priceTop, priceBottom, volumeTop,
      volumeBottom, start, end, coordinates, prices, low, high, maxVolume
    };
  }

  draw() {
    const { ctx, width: w, height: h, candles } = this;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b1219';
    ctx.fillRect(0, 0, w, h);
    const frame = this.computeFrame();
    this.frame = frame;
    const { plotLeft: left, plotRight: right, priceTop: top, priceBottom: bottom,
      volumeTop, volumeBottom, start, end, coordinates, prices } = frame;

    ctx.font = '11px ui-monospace, SFMono-Regular, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0f1a23';
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
      const candle = candles[i];
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
      ctx.fillStyle = candle.close >= candle.open ? 'rgba(102,175,133,.50)' : 'rgba(195,88,102,.50)';
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
    if (this.showEMA) line(ema(candles, 20), '#e4b36c');
    if (this.showSMA) line(sma(candles, 50), '#88a8e2');
    ctx.restore();

    const point = (p) => ({
      x: coordinates.x(this.timeToIndex(p.time)),
      y: prices.y(p.price)
    });
    const drawLine = (a, b, alpha = 1) => {
      const p = point(a), q = point(b);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#d6b77b'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      ctx.globalAlpha = 1;
    };
    for (const drawing of this.drawings) drawLine(drawing.a, drawing.b);
    if (this.drawingAnchor && this.pointer) {
      drawLine(this.drawingAnchor, this.pointerToMarket(this.pointer.x, this.pointer.y), .8);
    }
    ctx.restore();

    if (candles.length) {
      const last = candles[candles.length - 1];
      const lastY = prices.y(last.close);
      ctx.strokeStyle = '#ddc093';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(left, lastY); ctx.lineTo(right, lastY); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#c6a873';
      ctx.fillRect(right + 1, lastY - 10, w - right - 2, 20);
      ctx.fillStyle = '#101820';
      ctx.fillText(formatPrice(last.close), right + 5, lastY);
    }

    if (this.pointer && this.pointer.x >= left && this.pointer.x <= right) {
      const { x, y } = this.pointer;
      ctx.strokeStyle = COLORS.cross;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(x + .5, top); ctx.lineTo(x + .5, volumeBottom); ctx.stroke();
      if (y <= bottom && y >= top) {
        ctx.beginPath(); ctx.moveTo(left, y + .5); ctx.lineTo(right, y + .5); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#405261'; ctx.fillRect(right + 1, y - 10, w - right - 2, 20);
        ctx.fillStyle = '#f4f7f9'; ctx.fillText(formatPrice(prices.price(y)), right + 5, y);
      }
      ctx.setLineDash([]);
      const index = Math.round(coordinates.index(x));
      const selected = candles[index];
      if (selected) {
        ctx.fillStyle = '#192934';
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

  pointerDown(event) {
    if (event.button === 2) {
      if (this.drawingAnchor) { this.drawingAnchor = null; this.requestDraw(); }
      return;
    }
    if (event.button !== 0 || !this.candles.length) return;
    this.canvas.focus({ preventScroll: true });
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    this.pointer = { x, y };
    this.canvas.setPointerCapture(event.pointerId);
    if (this.tool === 'line') {
      const point = this.pointerToMarket(x, y);
      if (this.drawingAnchor) {
        this.drawings.push({ a: this.drawingAnchor, b: point });
        this.drawingAnchor = null;
        this.onDrawingsChange(this.drawings);
      } else this.drawingAnchor = point;
    } else {
      this.drag = { startX: x, offset: this.offsetBars };
      this.canvas.style.cursor = 'grabbing';
    }
    this.requestDraw();
  }

  pointerMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (this.drag) {
      const delta = (this.pointer.x - this.drag.startX) / this.barWidth;
      this.offsetBars = clamp(this.drag.offset + delta, -this.candles.length + 6, 60);
    }
    const index = Math.round((this.frame || this.computeFrame()).coordinates.index(this.pointer.x));
    this.onHover(this.candles[index] || null);
    if (this.drag) this.maybeNeedHistory();
    this.requestDraw();
  }

  pointerUp() {
    this.drag = null;
    this.canvas.style.cursor = this.tool === 'line' ? 'crosshair' : 'grab';
  }

  pointerCancel() {
    this.pointerUp();
    this.pointer = null;
    this.requestDraw();
  }

  wheel(event) {
    if (!this.candles.length) return;
    event.preventDefault();
    const bounds = this.canvas.getBoundingClientRect();
    const x = clamp(event.clientX - bounds.left, 12, this.width - 80);
    const oldIndex = this.computeFrame().coordinates.index(x);
    const direction = event.deltaY < 0 ? 1 : -1;
    this.barWidth = clamp(this.barWidth * (direction > 0 ? 1.16 : 1 / 1.16), 2, 45);
    const right = this.width - 80;
    this.offsetBars = clamp(this.candles.length - 1 + this.gap -
      oldIndex - (right - x) / this.barWidth, -this.candles.length + 6, 60);
    this.maybeNeedHistory();
    this.requestDraw();
  }

  keyDown(event) {
    if (event.key === 'Escape') this.drawingAnchor = null;
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      this.undoDrawing();
    } else if (event.key === 'ArrowLeft') {
      this.offsetBars = clamp(this.offsetBars + 4, -this.candles.length + 6, 60);
    } else if (event.key === 'ArrowRight') {
      this.offsetBars = clamp(this.offsetBars - 4, -this.candles.length + 6, 60);
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
