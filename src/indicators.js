// Indicator outputs preserve input indices; insufficient history is null.
export function sma(candles, period, field = 'close') {
  if (!Number.isInteger(period) || period < 1) throw new RangeError('Invalid period');
  const values = Array(candles.length).fill(null);
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i][field];
    if (i >= period) sum -= candles[i - period][field];
    if (i >= period - 1) values[i] = sum / period;
  }
  return values;
}

export function ema(candles, period, field = 'close') {
  if (!Number.isInteger(period) || period < 1) throw new RangeError('Invalid period');
  const values = Array(candles.length).fill(null);
  if (candles.length < period) return values;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += candles[i][field];
  let prev = seed / period;
  values[period - 1] = prev;
  const alpha = 2 / (period + 1);
  for (let i = period; i < candles.length; i++) {
    prev = (candles[i][field] - prev) * alpha + prev;
    values[i] = prev;
  }
  return values;
}

export function rsi(candles, period = 14) {
  if (!Number.isInteger(period) || period < 1) throw new RangeError('Invalid period');
  const out = Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = candles[i].close - candles[i - 1].close;
    gains += Math.max(d, 0);
    losses += Math.max(-d, 0);
  }
  let avgGain = gains / period, avgLoss = losses / period;
  const value = () => avgLoss === 0 ? (avgGain === 0 ? 50 : 100) :
    100 - 100 / (1 + avgGain / avgLoss);
  out[period] = value();
  for (let i = period + 1; i < candles.length; i++) {
    const d = candles[i].close - candles[i - 1].close;
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = value();
  }
  return out;
}


/** Bollinger Bands with population standard deviation of close values. */
export function bollingerBands(candles, period = 20, deviation = 2) {
  if (!Number.isInteger(period) || period < 2 || !Number.isFinite(deviation) || deviation <= 0) {
    throw new RangeError('Invalid Bollinger configuration');
  }
  const basis = sma(candles, period);
  const upper = Array(candles.length).fill(null);
  const lower = Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i++) {
    const mean = basis[i];
    let squareError = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const delta = candles[j].close - mean;
      squareError += delta * delta;
    }
    const band = deviation * Math.sqrt(squareError / period);
    upper[i] = mean + band;
    lower[i] = mean - band;
  }
  return { basis, upper, lower };
}
