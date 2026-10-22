// Visual market motion: immutable exchange snapshots remain the source of truth.
// Every interpolated value is for painting only, never persisted as OHLCV or L2.
export const MOTION_DURATION_MS = 180;
export const PULSE_DURATION_MS = 320;

export function motionProgress(start, now, duration = MOTION_DURATION_MS) {
  if (!Number.isFinite(start) || !Number.isFinite(now) || !(duration > 0)) return 1;
  const t = Math.max(0, Math.min(1, (now - start) / duration));
  return 1 - (1 - t) ** 3;
}

export function interpolateCandle(from, to, t) {
  if (!from || !to || from.time !== to.time) return to;
  const p = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 1));
  if (p === 0) return from;
  if (p === 1) return to;
  const mix = (a, b) => a + (b - a) * p;
  const open = mix(from.open, to.open);
  const close = mix(from.close, to.close);
  return {
    ...to,
    open,
    close,
    high: Math.max(open, close, mix(from.high, to.high)),
    low: Math.min(open, close, mix(from.low, to.low)),
    volume: Math.max(0, mix(from.volume, to.volume))
  };
}

function prepareSide(rows, descending) {
  if (!Array.isArray(rows)) return { prices: [], sums: [0] };
  const filtered = rows.filter((row) =>
    Array.isArray(row) && Number.isFinite(row[0]) && row[0] > 0 &&
    Number.isFinite(row[1]) && row[1] > 0).slice(0, 1000)
    .sort((a, b) => descending ? b[0] - a[0] : a[0] - b[0]);
  const prices = [];
  const sums = [0];
  for (const [price, quantity] of filtered) {
    // Duplicate price levels are combined rather than inventing ladder positions.
    if (prices.length && prices.at(-1) === price) {
      sums[sums.length - 1] += quantity;
      continue;
    }
    prices.push(price);
    sums.push(sums.at(-1) + quantity);
  }
  return { prices, sums };
}
export function prepareDepthProfile(book) {
  if (!book || !Array.isArray(book.bids) || !Array.isArray(book.asks)) return null;
  return { bids: prepareSide(book.bids, true), asks: prepareSide(book.asks, false) };
}
function cumulativeAt(side, price, descending) {
  if (!Number.isFinite(price)) return 0;
  let lo = 0, hi = side.prices.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (descending ? side.prices[mid] >= price : side.prices[mid] <= price) lo = mid + 1;
    else hi = mid;
  }
  return side.sums[lo];
}
/** priceSamples are top-to-bottom screen prices, already mapped for log scales. */
export function sampleDepthProfile(prepared, priceSamples) {
  if (!prepared || !Array.isArray(priceSamples)) return null;
  return {
    bids: priceSamples.map((p) => cumulativeAt(prepared.bids, p, true)),
    asks: priceSamples.map((p) => cumulativeAt(prepared.asks, p, false))
  };
}
export function interpolateDepthProfile(from, to, t) {
  if (!to) return null;
  if (!from || from.bids.length !== to.bids.length || from.asks.length !== to.asks.length)
    return to;
  const p = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 1));
  const mix = (a, b) => a + (b - a) * p;
  return {
    bids: to.bids.map((v, i) => mix(from.bids[i], v)),
    asks: to.asks.map((v, i) => mix(from.asks[i], v))
  };
}

/** Coalesced update-to-Canvas-draw latency and active-frame cadence diagnostics. */
export class MarketRenderMetrics {
  constructor(limit = 90) {
    this.limit = limit;
    this.latencies = [];
    this.drawDurations = [];
    this.activeIntervals = [];
    this.pendingUpdateAt = null;
    this.previousFrameAt = null;
    this.samples = 0;
  }
  noteUpdate(at) {
    if (Number.isFinite(at)) this.pendingUpdateAt = at;
  }
  noteDraw(at, duration = 0) {
    if (!Number.isFinite(at)) return;
    this.samples++;
    if (this.pendingUpdateAt !== null) {
      this.push(this.latencies, Math.max(0, at - this.pendingUpdateAt));
      this.pendingUpdateAt = null;
    }
    if (Number.isFinite(duration) && duration >= 0) this.push(this.drawDurations, duration);
    if (this.previousFrameAt !== null) {
      const interval = at - this.previousFrameAt;
      // Ignore long idle gaps; FPS describes active transitions only.
      if (interval > 0 && interval <= 100) this.push(this.activeIntervals, interval);
    }
    this.previousFrameAt = at;
  }
  push(list, number) {
    list.push(number);
    if (list.length > this.limit) list.shift();
  }
  snapshot() {
    const quantile = (list, q) => list.length ?
      [...list].sort((a, b) => a - b)[Math.ceil(q * list.length) - 1] : null;
    const mean = this.activeIntervals.length ?
      this.activeIntervals.reduce((a, b) => a + b, 0) / this.activeIntervals.length : null;
    return {
      samples: this.samples,
      updateToDrawMs: quantile(this.latencies, 0.95),
      canvasDrawMs: quantile(this.drawDurations, 0.95),
      activeFps: mean ? Math.round(1000 / mean) : null
    };
  }
}
