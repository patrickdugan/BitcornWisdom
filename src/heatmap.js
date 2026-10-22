import { clamp, formatPrice } from './core.js';

// Compact viridis lookup to avoid a visualization dependency.
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

/** Aggregate near-mid liquidity into bounded price bins (base quantity per bin). */
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

export class LiquidityHeatmap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.columns = [];
    this.maxColumns = 160;
    this.lastSample = 0;
    this.raf = null;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
  }

  clear() {
    this.columns.length = 0;
    this.lastSample = 0;
    this.requestDraw();
  }

  ingest(book, price) {
    if (!book?.bids?.length || !book?.asks?.length || !Number.isFinite(price)) return;
    const now = book.time || Date.now();
    // An historical heatmap must accumulate time columns, not one column per 100ms packet.
    if (now - this.lastSample < 950) return;
    this.lastSample = now;
    this.columns.push({
      time: now, price,
      levels: binBookLevels(book, price)
    });
    if (this.columns.length > this.maxColumns) this.columns.shift();
    this.requestDraw();
  }

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
    this.raf = requestAnimationFrame(() => { this.raf = null; this.draw(); });
  }

  draw() {
    const { ctx, width: w, height: h, columns } = this;
    ctx.fillStyle = '#0b1219';
    ctx.fillRect(0, 0, w, h);
    ctx.font = '10px ui-monospace, monospace';
    if (!columns.length) {
      ctx.fillStyle = '#82909c';
      ctx.fillText('Waiting for depth snapshots...', 12, h / 2);
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
    // Keep scale stable enough for shallow (20-level) partial books.
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
    }

    ctx.beginPath();
    for (let i = 0; i < columns.length; i++) {
      const x = startX + i * colWidth;
      const yy = y(columns[i].price);
      if (i === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.strokeStyle = '#e8e5de';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = '#182732';
    ctx.fillRect(w - 52, 0, 52, h);
    ctx.fillStyle = '#98a7b2';
    ctx.textAlign = 'left';
    ctx.fillText(formatPrice(high), w - 50, 12);
    ctx.fillText(formatPrice(latest.price), w - 50, y(latest.price) + 3);
    ctx.fillText(formatPrice(low), w - 50, h - 7);
    ctx.fillStyle = '#788994';
    ctx.fillText('recent →', 6, h - 8);
  }

  destroy() {
    this.resizeObserver.disconnect();
    if (this.raf !== null) cancelAnimationFrame(this.raf);
  }
}
