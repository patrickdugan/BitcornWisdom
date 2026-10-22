import { clamp, formatPrice } from './core.js';
import {
  ARCHIVE_POLICY, combineLiquiditySamples, liquidityWindow, validLiquiditySample
} from './liquidity-archive.js';

const STOPS = [
  [68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]
];
const VIRIDIS = Array.from({ length: 256 }, (_, n) => {
  const position = n / 255 * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(position));
  const f = position - i;
  return 'rgb(' + STOPS[i].map((v, k) =>
    Math.round(v + (STOPS[i + 1][k] - v) * f)).join(',') + ')';
});
export const heatColor = (fraction) => VIRIDIS[Math.round(clamp(fraction, 0, 1) * 255)];

/** Retain at most 200 sparse price bins, with summed approximate base quantity. */
export function binBookLevels(book, mid, range = 0.01, bucketCount = 200) {
  if (!Number.isFinite(mid) || mid <= 0 || range <= 0 || !Number.isInteger(bucketCount) ||
      bucketCount < 1) return [];
  const low = mid * (1 - range);
  const high = mid * (1 + range);
  const width = (high - low) / bucketCount;
  const bins = new Map();
  for (const [price, quantity] of [...(book?.bids || []), ...(book?.asks || [])]) {
    if (!(price >= low && price <= high && quantity > 0)) continue;
    const index = Math.min(bucketCount - 1, Math.floor((price - low) / width));
    const center = low + width * (index + .5);
    bins.set(index, (bins.get(index) || 0) + price * quantity / center);
  }
  return [...bins].sort((a, b) => a[0] - b[0]).map(([index, quantity]) =>
    [low + width * (index + .5), quantity]);
}

/** A recorded column describes liquidity observed at time 'at' by THIS browser. */
export function makeLiquiditySample(book, price, series, at = Date.now()) {
  if (!book?.bids?.length || !book?.asks?.length || !Number.isFinite(price) ||
      !Number.isSafeInteger(at)) return null;
  const row = {
    version: ARCHIVE_POLICY.version,
    series, at,
    exchangeAt: Number.isFinite(book.time) && book.time >= 0 ? book.time : null,
    price, source: book.source || 'sampled-depth',
    levels: binBookLevels(book, price)
  };
  return validLiquiditySample(row) ? row : null;
}

export class LiquidityHeatmap {
  constructor(canvas, { onChange = () => {} } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.series = null;
    this.history = [];
    this.maxColumns = 160;
    this.maxHistory = ARCHIVE_POLICY.maxLoaded;
    this.lastSample = 0;
    this.mode = 'live';
    this.replayTime = null;
    this.raf = null;
    this.onChange = onChange;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
  }

  clear(series = null) {
    this.series = series;
    this.history = [];
    this.lastSample = 0;
    this.mode = 'live';
    this.replayTime = null;
    this.requestDraw();
    this.notify();
  }

  restore(rows, series = this.series) {
    if (series !== this.series) return;
    const eligible = rows.filter((r) => r.series === this.series);
    this.history = combineLiquiditySamples(eligible, this.history, this.maxHistory);
    this.lastSample = Math.max(this.lastSample, this.history.at(-1)?.at || 0);
    this.requestDraw();
    this.notify();
  }

  /** Returns a single validated, sampled column, suitable for IndexedDB. */
  ingest(book, price, at = Date.now()) {
    if (!this.series || at - this.lastSample < 950) return null;
    const sample = makeLiquiditySample(book, price, this.series, at);
    if (!sample) return null;
    this.lastSample = at;
    if (!this.history.length || sample.at > this.history.at(-1).at) {
      this.history.push(sample);
      if (this.history.length > this.maxHistory) this.history.shift();
    } else {
      this.history = combineLiquiditySamples(this.history, [sample], this.maxHistory);
    }
    this.requestDraw();
    this.notify();
    return sample;
  }

  get replayIndex() {
    if (!this.history.length) return 0;
    if (this.mode === 'live' || this.replayTime === null) return this.history.length - 1;
    let lo = 0, hi = this.history.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.history[mid].at <= this.replayTime) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  seek(index) {
    if (!this.history.length) return;
    const n = clamp(Math.floor(index), 0, this.history.length - 1);
    this.mode = 'replay';
    this.replayTime = this.history[n].at;
    this.requestDraw();
    this.notify();
  }

  goLive() {
    this.mode = 'live';
    this.replayTime = null;
    this.requestDraw();
    this.notify();
  }

  get visibleColumns() {
    const end = this.mode === 'replay' ? this.replayIndex : this.history.length - 1;
    return liquidityWindow(this.history, end, this.maxColumns);
  }

  getState() {
    const index = this.replayIndex;
    const chosen = this.history[index];
    return {
      series: this.series, count: this.history.length, index,
      mode: this.mode, at: chosen?.at || null, source: chosen?.source || null,
      firstAt: this.history[0]?.at || null, lastAt: this.history.at(-1)?.at || null
    };
  }

  notify() { this.onChange(this.getState()); }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.width = Math.max(140, rect.width);
    this.height = Math.max(80, rect.height);
    const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.requestDraw();
  }

  requestDraw() {
    if (this.raf !== null) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      this.draw();
    });
  }

  draw() {
    const { ctx, width: w, height: h } = this;
    const columns = this.visibleColumns;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b1219';
    ctx.fillRect(0, 0, w, h);
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    if (!columns.length) {
      ctx.fillStyle = '#82909c';
      ctx.fillText('Recording begins with the first observed book…', 10, h / 2);
      return;
    }
    const latest = columns.at(-1);
    let low = Infinity, high = -Infinity, peak = 1;
    for (const col of columns) {
      for (const [price, qty] of col.levels) {
        low = Math.min(low, price);
        high = Math.max(high, price);
        peak = Math.max(peak, Math.log1p(qty * price));
      }
    }
    if (!Number.isFinite(low)) { low = latest.price * 0.999; high = latest.price * 1.001; }
    const spread = Math.max(high - low, latest.price * .00005);
    low -= spread * .12;
    high += spread * .12;
    const y = (price) => clamp((high - price) / (high - low) * (h - 12) + 6, 5, h - 6);
    const colWidth = (w - 54) / this.maxColumns;
    const startX = w - 54 - columns.length * colWidth;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const x = startX + i * colWidth;
      for (const [price, qty] of col.levels) {
        const fraction = Math.log1p(qty * price) / peak;
        ctx.fillStyle = heatColor(fraction);
        ctx.fillRect(x, Math.round(y(price)) - 1, Math.max(1, colWidth + .35), 2.5);
      }
      if (i > 0 && col.at - columns[i - 1].at > 4_000) {
        // An offline interval is a true missing observation, not a straight line.
        ctx.fillStyle = 'rgba(220,220,220,.45)';
        ctx.fillRect(x, 4, 1.5, h - 9);
      }
    }

    ctx.beginPath();
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const x = startX + i * colWidth;
      const yy = y(col.price);
      if (i === 0 || col.at - columns[i - 1].at > 4_000) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.strokeStyle = '#e8e5de';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = '#182732';
    ctx.fillRect(w - 52, 0, 52, h);
    ctx.fillStyle = '#98a7b2';
    ctx.fillText(formatPrice(high), w - 50, 12);
    ctx.fillText(formatPrice(latest.price), w - 50, y(latest.price) + 3);
    ctx.fillText(formatPrice(low), w - 50, h - 7);
    ctx.fillStyle = '#788994';
    ctx.fillText(this.mode === 'replay' ? 'REPLAY' : 'LIVE', 6, h - 8);
  }

  destroy() {
    this.resizeObserver.disconnect();
    if (this.raf !== null) cancelAnimationFrame(this.raf);
  }
}
