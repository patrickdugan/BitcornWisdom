// Visual market motion: immutable exchange snapshots remain the source of truth.
// Every interpolated value is for painting only, never persisted as OHLCV or L2.
export const MOTION_DURATION_MS = 180;
export const PULSE_DURATION_MS = 320;
export const TICK_LERP_DURATION_MS = 220;
export const TICK_FLASH_DURATION_MS = 380;
export const CLEARED_LEVEL_TTL_MS = 420;
export const LEVEL_SWEEP_RATIO = 0.25;

export function motionProgress(start, now, duration = MOTION_DURATION_MS) {
  if (!Number.isFinite(start) || !Number.isFinite(now) || !(duration > 0)) return 1;
  const t = Math.max(0, Math.min(1, (now - start) / duration));
  return 1 - (1 - t) ** 3;
}

export function decayFactor(start, now, ttlMs = CLEARED_LEVEL_TTL_MS) {
  if (!Number.isFinite(start) || !Number.isFinite(now) || !(ttlMs > 0)) return 0;
  if (now <= start) return 1;
  const elapsed = now - start;
  if (elapsed >= ttlMs) return 0;
  return Math.max(0, Math.min(1, 1 - elapsed / ttlMs));
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

/**
 * Authentic 2013-2016 bitcoinwisdom.com 60fps active-candle tick interpolator.
 * Smoothly lerps displayedClose, displayedHigh, displayedLow, and displayedVolume
 * toward live trade ticks and kline frames while computing tick-delta flash & volume pulse.
 */
export class CandleTickAnimator {
  constructor({
    lerpDurationMs = TICK_LERP_DURATION_MS,
    flashDurationMs = TICK_FLASH_DURATION_MS
  } = {}) {
    this.lerpDurationMs = lerpDurationMs;
    this.flashDurationMs = flashDurationMs;
    this.reset();
  }

  reset() {
    this.barTime = null;
    this.from = null;
    this.target = null;
    this.startedAt = -Infinity;
    this.flashStartedAt = -Infinity;
    this.volumePulseStartedAt = -Infinity;
    this.direction = 'flat';
    this.tickDelta = 0;
    this.lastTradeTime = -Infinity;
  }

  seed(candle) {
    if (!candle || !Number.isFinite(candle.close)) {
      this.reset();
      return null;
    }
    const snap = {
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: Math.max(0, candle.volume || 0)
    };
    this.barTime = snap.time;
    this.from = { ...snap };
    this.target = { ...snap };
    this.startedAt = -Infinity;
    this.flashStartedAt = -Infinity;
    this.volumePulseStartedAt = -Infinity;
    this.direction = 'flat';
    this.tickDelta = 0;
    return snap;
  }

  onCandle(candle, now = 0) {
    if (!candle || !Number.isFinite(candle.close)) return null;
    if (this.barTime === null || candle.time !== this.barTime) {
      const prevClose = this.target?.close ?? candle.open;
      const delta = candle.close - prevClose;
      this.seed(candle);
      this.tickDelta = delta;
      this.direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
      if (Number.isFinite(now)) {
        this.flashStartedAt = now;
        this.volumePulseStartedAt = now;
      }
      return this.sample(now);
    }

    const current = this.sample(now);
    const prevTargetClose = this.target.close;
    const prevTargetVolume = this.target.volume;
    const delta = candle.close - prevTargetClose;
    this.from = {
      time: candle.time,
      open: current.displayedOpen,
      high: current.displayedHigh,
      low: current.displayedLow,
      close: current.displayedClose,
      volume: current.displayedVolume
    };
    this.target = {
      time: candle.time,
      open: candle.open,
      high: Math.max(candle.high, candle.open, candle.close),
      low: Math.min(candle.low, candle.open, candle.close),
      close: candle.close,
      volume: Math.max(0, candle.volume || 0)
    };
    this.startedAt = now;
    if (delta !== 0) {
      this.tickDelta = delta;
      this.direction = delta > 0 ? 'up' : 'down';
      this.flashStartedAt = now;
    } else if (this.target.volume > prevTargetVolume) {
      this.tickDelta = 0;
      this.direction = 'flat';
      this.flashStartedAt = now;
    }
    if (this.target.volume > prevTargetVolume || delta !== 0) {
      this.volumePulseStartedAt = now;
    }
    return this.sample(now);
  }

  onTrade(trade, fallbackCandle = null, now = 0) {
    if (!trade || !Number.isFinite(trade.price) || trade.price <= 0) return null;
    if (Number.isFinite(trade.time) && trade.time < this.lastTradeTime) return this.sample(now);
    if (Number.isFinite(trade.time)) this.lastTradeTime = trade.time;

    if (this.barTime === null && fallbackCandle) {
      this.seed(fallbackCandle);
    }
    if (this.barTime === null) {
      const synthetic = {
        time: Number.isFinite(trade.time) ? trade.time : 0,
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
        volume: Math.max(0, Number(trade.quantity) || 0)
      };
      this.seed(synthetic);
      this.direction = trade.side === 'sell' ? 'down' : trade.side === 'buy' ? 'up' : 'flat';
      this.flashStartedAt = now;
      this.volumePulseStartedAt = now;
      return this.sample(now);
    }

    const current = this.sample(now);
    const prevClose = this.target.close;
    const delta = trade.price - prevClose;
    const qty = Number.isFinite(trade.quantity) && trade.quantity > 0 ? trade.quantity : 0;

    this.from = {
      time: this.barTime,
      open: current.displayedOpen,
      high: current.displayedHigh,
      low: current.displayedLow,
      close: current.displayedClose,
      volume: current.displayedVolume
    };
    this.target = {
      time: this.barTime,
      open: this.target.open,
      high: Math.max(this.target.high, trade.price, this.target.open),
      low: Math.min(this.target.low, trade.price, this.target.open),
      close: trade.price,
      volume: this.target.volume + qty
    };
    this.tickDelta = delta;
    this.direction = delta > 0 ? 'up' : delta < 0 ? 'down' :
      (trade.side === 'buy' ? 'up' : trade.side === 'sell' ? 'down' : 'flat');
    this.startedAt = now;
    this.flashStartedAt = now;
    this.volumePulseStartedAt = now;
    return this.sample(now);
  }

  isActive(now = 0) {
    if (this.barTime === null || !Number.isFinite(now)) return false;
    return (
      (now - this.startedAt >= 0 && now - this.startedAt < this.lerpDurationMs) ||
      decayFactor(this.flashStartedAt, now, this.flashDurationMs) > 0 ||
      decayFactor(this.volumePulseStartedAt, now, this.flashDurationMs) > 0
    );
  }

  sample(now = 0) {
    if (!this.target || !this.from) return null;
    const t = motionProgress(this.startedAt, now, this.lerpDurationMs);
    const interpolated = interpolateCandle(this.from, this.target, t);
    const flashIntensity = decayFactor(this.flashStartedAt, now, this.flashDurationMs);
    const volumePulse = decayFactor(this.volumePulseStartedAt, now, this.flashDurationMs);
    return {
      time: interpolated.time,
      displayedOpen: interpolated.open,
      displayedClose: interpolated.close,
      displayedHigh: interpolated.high,
      displayedLow: interpolated.low,
      displayedVolume: interpolated.volume,
      targetClose: this.target.close,
      targetHigh: this.target.high,
      targetLow: this.target.low,
      direction: this.direction,
      tickDelta: this.tickDelta,
      flashIntensity,
      volumePulse,
      active: this.isActive(now),
      candle: interpolated
    };
  }
}

function prepareSide(rows, descending) {
  if (!Array.isArray(rows)) return { prices: [], sums: [0], levels: [] };
  const filtered = rows.filter((row) =>
    Array.isArray(row) && Number.isFinite(row[0]) && row[0] > 0 &&
    Number.isFinite(row[1]) && row[1] > 0).slice(0, 1000)
    .sort((a, b) => descending ? b[0] - a[0] : a[0] - b[0]);
  const prices = [];
  const sums = [0];
  const levels = [];
  for (const [price, quantity] of filtered) {
    // Duplicate price levels are combined rather than inventing ladder positions.
    if (prices.length && prices.at(-1) === price) {
      sums[sums.length - 1] += quantity;
      levels[levels.length - 1][1] += quantity;
      continue;
    }
    prices.push(price);
    sums.push(sums.at(-1) + quantity);
    levels.push([price, quantity]);
  }
  return { prices, sums, levels };
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
