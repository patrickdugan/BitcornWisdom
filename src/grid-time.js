// UTC viewport projection for independent candle intervals and exchange histories.
// Converts each chart's index-based x axis into an interpolated timestamp window.
// No DOM, network, or timers; safe to exercise with synthetic candles.
import { clamp, INTERVAL_MS } from './core.js';

const intervalMs = (interval) => INTERVAL_MS[interval] || 60_000;
const plotWidth = (chart) => Math.max(1, chart.width - 92);

export function timeAtIndex(candles, index, interval) {
  if (!candles.length || !Number.isFinite(index)) return null;
  const step = intervalMs(interval);
  const last = candles.length - 1;
  if (index <= 0) return candles[0].time + index * step;
  if (index >= last) return candles[last].time + (index - last) * step;
  const left = Math.floor(index), fraction = index - left;
  return candles[left].time + (candles[left + 1].time - candles[left].time) * fraction;
}
export function indexAtTime(candles, time, interval) {
  if (!candles.length || !Number.isFinite(time)) return null;
  const step = intervalMs(interval);
  const last = candles.length - 1;
  if (time <= candles[0].time) return (time - candles[0].time) / step;
  if (time >= candles[last].time) return last + (time - candles[last].time) / step;
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (candles[mid].time <= time) lo = mid;
    else hi = mid;
  }
  const span = candles[hi].time - candles[lo].time;
  return lo + (span > 0 ? (time - candles[lo].time) / span : 0);
}
export function getUTCViewport(chart) {
  if (!chart?.candles?.length || !(chart.barWidth > 0)) return null;
  const rightIndex = chart.candles.length - 1 + chart.gap - chart.offsetBars;
  const leftIndex = rightIndex - plotWidth(chart) / chart.barWidth;
  return {
    start: timeAtIndex(chart.candles, leftIndex, chart.interval),
    end: timeAtIndex(chart.candles, rightIndex, chart.interval)
  };
}
export function applyUTCViewport(chart, window) {
  if (!chart?.candles?.length || !window ||
    !Number.isFinite(window.start) || !Number.isFinite(window.end) ||
    !(window.end > window.start)) return false;
  const candles = chart.candles;
  // A feed might offer only a few hours of history while its peer has days.
  if (window.end < candles[0].time || window.start > candles.at(-1).time) return false;
  const left = indexAtTime(candles, window.start, chart.interval);
  const right = indexAtTime(candles, window.end, chart.interval);
  const width = plotWidth(chart);
  if (!(right > left)) return false;
  chart.barWidth = clamp(width / (right - left), 2, 45);
  // Keep the same UTC midpoint anchored when zoom reaches a renderer limit.
  const middle = indexAtTime(candles, (window.start + window.end) / 2, chart.interval);
  const centeredRight = middle + width / (chart.barWidth * 2);
  chart.offsetBars = clamp(candles.length - 1 + chart.gap - centeredRight,
    -60, candles.length - 1 + chart.gap);
  chart.requestDraw();
  return true;
}
