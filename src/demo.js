import { INTERVAL_MS, clamp } from './core.js';

// Deterministic offline market feed for UI development and network-blocked regions.
export function makeDemoCandles(interval = '1m', count = 900, now = Date.now()) {
  const duration = INTERVAL_MS[interval] || INTERVAL_MS['1m'];
  const end = Math.floor(now / duration) * duration;
  const data = [];
  let price = 72_000;
  for (let i = 0; i < count; i++) {
    const open = price;
    const drift = (Math.sin(i * 0.13) * 23 + Math.cos(i * 0.037) * 34 +
      Math.sin(i * 1.73) * 19);
    price = Math.max(100, open + drift);
    const high = Math.max(open, price) + 5 + Math.abs(Math.sin(i * 0.33) * 22);
    const low = Math.min(open, price) - 5 - Math.abs(Math.cos(i * 0.2) * 17);
    data.push({
      time: end - (count - i - 1) * duration, open, high, low,
      close: price, volume: 3 + Math.abs(Math.sin(i * 2.7) * 14)
    });
  }
  return data;
}

export function makeDemoDepth(mid, time = Date.now()) {
  const bids = [], asks = [];
  for (let i = 1; i <= 20; i++) {
    const delta = 0.5 + i * 0.85;
    const qty = 0.1 + Math.abs(Math.sin(time / 13_000 + i * 2.4) * 2.5);
    bids.push([mid - delta, qty]);
    asks.push([mid + delta, qty * (0.75 + Math.sin(i) * 0.2)]);
  }
  return { time, lastUpdateId: 0, bids, asks };
}

export function nextDemoCandle(last, interval, tick) {
  const duration = INTERVAL_MS[interval] || 60_000;
  const now = Date.now();
  const time = Math.floor(now / duration) * duration;
  const price = Math.max(1, last.close + Math.sin(tick * 1.3) * 9 + Math.cos(tick * 0.38) * 3);
  if (time > last.time) {
    return { time, open: last.close, high: Math.max(last.close, price),
      low: Math.min(last.close, price), close: price, volume: 0.15 };
  }
  return { ...last, close: price, high: Math.max(last.high, price),
    low: Math.min(last.low, price), volume: clamp(last.volume + 0.15, 0, 1e9) };
}
