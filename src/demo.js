import { INTERVAL_MS, clamp } from './core.js';

// Deterministic offline market feed for UI development and network-blocked regions.
export function makeDemoCandles(interval = '1m', count = 900, now = Date.now(), anchorClose = null) {
  const duration = INTERVAL_MS[interval] || INTERVAL_MS['1m'];
  const end = Math.floor(now / duration) * duration;
  const data = [];
  let price = Number.isFinite(anchorClose) && anchorClose > 0 ? anchorClose : 72_000;
  const scale = price / 72_000;
  for (let i = 0; i < count; i++) {
    const open = price;
    const drift = (Math.sin(i * 0.13) * 23 + Math.cos(i * 0.037) * 34 +
      Math.sin(i * 1.73) * 19) * scale;
    price = Math.max(100, open + drift);
    const high = Math.max(open, price) + (5 + Math.abs(Math.sin(i * 0.33) * 22)) * scale;
    const low = Math.max(10, Math.min(open, price) - (5 + Math.abs(Math.cos(i * 0.2) * 17)) * scale);
    data.push({
      time: end - (count - i - 1) * duration, open, high, low,
      close: price, volume: 3 + Math.abs(Math.sin(i * 2.7) * 14)
    });
  }
  if (Number.isFinite(anchorClose) && anchorClose > 0 && data.length) {
    const shift = anchorClose - data[data.length - 1].close;
    for (const c of data) {
      c.open = Math.max(10, c.open + shift);
      c.high = Math.max(10, c.high + shift);
      c.low = Math.max(10, c.low + shift);
      c.close = Math.max(10, c.close + shift);
      c.high = Math.max(c.high, c.open, c.close);
      c.low = Math.min(c.low, c.open, c.close);
    }
  }
  return data;
}

export function makeDemoDepth(mid, time = Date.now()) {
  const bids = [], asks = [];
  const anchor = Math.round(mid / 2) * 2;
  const step = Math.floor(time / 1000);
  const sweptBidIdx = (step % 5) + 1;
  const sweptAskIdx = ((step + 2) % 5) + 1;
  for (let i = 1; i <= 20; i++) {
    const delta = i * 1.0;
    const baseQty = 0.22 + Math.abs(Math.sin(i * 2.1 + Math.floor(time / 6000) * 0.4) * 2.4);
    const bidQty = i === sweptBidIdx && step % 2 === 0 ? baseQty * 0.35 : baseQty;
    const askBase = baseQty * (0.78 + Math.sin(i) * 0.2);
    const askQty = i === sweptAskIdx && step % 2 === 1 ? askBase * 0.32 : askBase;
    bids.push([anchor - delta, bidQty]);
    asks.push([anchor + delta, askQty]);
  }
  return { time, lastUpdateId: 0, bids, asks };
}

export function nextDemoCandle(last, interval, tick, now = Date.now()) {
  const duration = INTERVAL_MS[interval] || 60_000;
  const time = Math.floor(now / duration) * duration;
  const price = Math.max(1, last.close + Math.sin(tick * 1.3) * 9 + Math.cos(tick * 0.38) * 3);
  if (time > last.time) {
    return { time, open: last.close, high: Math.max(last.close, price),
      low: Math.min(last.close, price), close: price, volume: 0.15 };
  }
  return { ...last, close: price, high: Math.max(last.high, price),
    low: Math.min(last.low, price), volume: clamp(last.volume + 0.15, 0, 1e9) };
}
