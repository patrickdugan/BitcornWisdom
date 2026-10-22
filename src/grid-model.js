// Serializable, bounded multi-chart layouts. No direct DOM or network dependencies.
export const GRID_MODES = Object.freeze([1, 2, 4]);
export const GRID_MARKETS = Object.freeze(['spot', 'futures', 'kraken', 'coinbase']);
export const GRID_INTERVALS = Object.freeze({
  spot: ['1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d','3d','1w'],
  futures: ['1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d','3d','1w'],
  kraken: ['1m','5m','15m','30m','1h','4h','1d','1w'],
  coinbase: ['1m','5m','15m','1h','6h','1d']
});
export const GRID_DEFAULTS = Object.freeze([
  { market: 'spot', symbol: 'BTCUSDT', interval: '5m' },
  { market: 'spot', symbol: 'ETHUSDT', interval: '5m' },
  { market: 'kraken', symbol: 'BTCUSD', interval: '1h' },
  { market: 'coinbase', symbol: 'BTCUSD', interval: '15m' }
]);
export function normalizeGridCell(raw, index = 0) {
  const fallback = GRID_DEFAULTS[index % GRID_DEFAULTS.length];
  if (!raw || typeof raw !== 'object' || !GRID_MARKETS.includes(raw.market)) return { ...fallback };
  const symbol = String(raw.symbol || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,24}$/.test(symbol)) return { ...fallback };
  return {
    market: raw.market,
    symbol,
    interval: GRID_INTERVALS[raw.market].includes(raw.interval) ? raw.interval : '5m'
  };
}
export function normalizeSplit(value) {
  const number = Number(value);
  return value === null || value === undefined || !Number.isFinite(number) ?
    50 : Math.round(Math.max(20, Math.min(80, number)) * 10) / 10;
}
export function normalizeGridLayout(raw) {
  const mode = GRID_MODES.includes(raw?.mode) ? raw.mode : 2;
  return {
    version: 2,
    mode,
    splitX: normalizeSplit(raw?.splitX),
    splitY: normalizeSplit(raw?.splitY),
    syncCrosshair: raw?.syncCrosshair !== false,
    syncRange: raw?.syncRange === true,
    demo: Boolean(raw?.demo),
    cells: Array.from({ length: 4 }, (_, index) => normalizeGridCell(raw?.cells?.[index], index))
  };
}
export function gridKey(market) {
  return [market.market, market.symbol, market.interval].join(':');
}
export const GRID_LAYOUT_KEY = 'bitcornwisdom:grid:v2';
export const GRID_PRESETS_KEY = 'bitcornwisdom:grid:presets:v1';
export const GRID_WORKSPACE_KIND = 'bitcornwisdom.grid.workspace';
export const GRID_PRESET_LIMIT = 20;
export const GRID_WORKSPACE_MAX_BYTES = 262144;

export function saveGridLayout(storage, layout, key = GRID_LAYOUT_KEY) {
  const canonical = normalizeGridLayout(layout);
  storage.setItem(key, JSON.stringify(canonical));
  return canonical;
}
export function loadGridLayout(storage, key = GRID_LAYOUT_KEY) {
  for (const candidate of key === GRID_LAYOUT_KEY ? [key, 'bitcornwisdom:grid:v1'] : [key]) {
    try {
      const data = storage.getItem(candidate);
      if (data !== null) return normalizeGridLayout(JSON.parse(data));
    } catch { /* A corrupt newer layout can fall back to a legacy version. */ }
  }
  return normalizeGridLayout(null);
}
export function normalizeGridPresetName(value) {
  return typeof value === 'string' ?
    value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 48) : '';
}
export function normalizeGridPresets(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const result = [];
  for (const item of input) {
    if (result.length === GRID_PRESET_LIMIT) break;
    const name = normalizeGridPresetName(item?.name);
    const key = name.toLocaleLowerCase('en');
    if (!name || seen.has(key) || !item?.layout || typeof item.layout !== 'object') continue;
    seen.add(key);
    result.push({ name, layout: normalizeGridLayout(item.layout) });
  }
  return result;
}
export function loadGridPresets(storage, key = GRID_PRESETS_KEY) {
  try { return normalizeGridPresets(JSON.parse(storage.getItem(key))); }
  catch { return []; }
}
export function saveGridPresets(storage, presets, key = GRID_PRESETS_KEY) {
  const canonical = normalizeGridPresets(presets);
  storage.setItem(key, JSON.stringify(canonical));
  return canonical;
}
const GRID_THEMES = ['noir', 'synth', 'verdigris'];
export function exportGridWorkspace(layout, presets, theme = 'noir') {
  return JSON.stringify({
    kind: GRID_WORKSPACE_KIND,
    version: 1,
    active: normalizeGridLayout(layout),
    presets: normalizeGridPresets(presets),
    theme: GRID_THEMES.includes(theme) ? theme : 'noir'
  }, null, 2) + '\n';
}
export function parseGridWorkspace(json) {
  if (typeof json !== 'string' || new TextEncoder().encode(json).length > GRID_WORKSPACE_MAX_BYTES)
    throw new RangeError('Workspace file must be JSON under 256 KiB');
  let parsed;
  try { parsed = JSON.parse(json); }
  catch { throw new TypeError('Workspace contains invalid JSON'); }
  if (!parsed || parsed.kind !== GRID_WORKSPACE_KIND || parsed.version !== 1 ||
    !parsed.active || typeof parsed.active !== 'object' || !Array.isArray(parsed.presets) ||
    parsed.presets.length > GRID_PRESET_LIMIT)
    throw new TypeError('Unsupported BitcornWisdom workspace format');
  return {
    active: normalizeGridLayout(parsed.active),
    presets: normalizeGridPresets(parsed.presets),
    theme: GRID_THEMES.includes(parsed.theme) ? parsed.theme : 'noir'
  };
}
