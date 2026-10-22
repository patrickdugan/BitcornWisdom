// Small, framework-free workspace preferences and command search primitives.
export const THEME_IDS = Object.freeze(['noir', 'synth', 'verdigris']);
export const THEME_NAMES = Object.freeze({
  noir: 'Noir / copper',
  synth: 'Afterhours / lilac',
  verdigris: 'Verdigris / mint'
});
export const MARKET_NAMES = Object.freeze({
  spot: 'Binance · Spot',
  futures: 'Binance · Perpetual',
  kraken: 'Kraken · Spot',
  coinbase: 'Coinbase · Exchange'
});
export const MARKET_PRESETS = Object.freeze([
  { market: 'spot', symbol: 'BTCUSDT' },
  { market: 'spot', symbol: 'ETHUSDT' },
  { market: 'spot', symbol: 'SOLUSDT' },
  { market: 'futures', symbol: 'BTCUSDT' },
  { market: 'kraken', symbol: 'BTCUSD' },
  { market: 'coinbase', symbol: 'BTCUSD' },
  { market: 'coinbase', symbol: 'ETHUSD' }
]);
export const MAX_FAVORITES = 32;

export function normalTheme(input) {
  return THEME_IDS.includes(input) ? input : 'noir';
}
export function marketKey(market) {
  return market.market + ':' + market.symbol;
}
export function normalizedMarket(input) {
  if (!input || typeof input !== 'object' ||
      !Object.hasOwn(MARKET_NAMES, input.market) ||
      typeof input.symbol !== 'string') return null;
  const symbol = input.symbol.trim().toUpperCase();
  return /^[A-Z0-9]{4,24}$/.test(symbol) ? { market: input.market, symbol } : null;
}
export function sanitizeFavorites(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set(), items = [];
  for (const item of input) {
    const market = normalizedMarket(item);
    if (!market) continue;
    const key = marketKey(market);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(market);
    if (items.length === MAX_FAVORITES) break;
  }
  return items;
}
export function toggleFavorite(input, item) {
  const market = normalizedMarket(item);
  if (!market) throw new RangeError('Invalid favorite market');
  const previous = sanitizeFavorites(input);
  const key = marketKey(market);
  return previous.some((v) => marketKey(v) === key) ?
    previous.filter((v) => marketKey(v) !== key) :
    [market, ...previous].slice(0, MAX_FAVORITES);
}
export function isFavorite(list, item) {
  const market = normalizedMarket(item);
  return market !== null && sanitizeFavorites(list).some((v) => marketKey(v) === marketKey(market));
}
const QUOTES = ['USDT','USDC','BUSD','USD','EUR','GBP','BTC','ETH'];
export function symbolLabel(symbol) {
  const upper = String(symbol).toUpperCase();
  const quote = QUOTES.find((q) => upper.endsWith(q) && upper.length > q.length);
  return quote ? upper.slice(0, -quote.length) + ' / ' + quote : upper;
}
export function searchPalette(entries, input = '', limit = 12) {
  if (!Array.isArray(entries)) return [];
  const query = String(input).trim().toLowerCase();
  if (query.length > 64) return [];
  if (!query) return entries.slice(0, limit);
  const tokens = query.split(/\s+/).filter(Boolean);
  return entries.map((entry, index) => {
    const text = (entry.title + ' ' + (entry.detail || '') + ' ' +
      (entry.keywords || '')).toLowerCase();
    const compact = text.replace(/[^a-z0-9]/g, '');
    if (!tokens.every((token) => text.includes(token) ||
        compact.includes(token.replace(/[^a-z0-9]/g, '')))) return null;
    const headline = entry.title.toLowerCase();
    let score = headline.startsWith(query) ? 100 : headline.includes(query) ? 50 : 0;
    if (entry.type === 'market') score += 3;
    return { entry, score, index };
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit).map((x) => x.entry);
}

export const CHART_COLORS = Object.freeze({
  noir: {
    bg: '#090f19', axis: '#101927', grid: '#24303e',
    labels: '#8194ad', cross: '#798da4', up: '#32d8ac', down: '#f47f94',
    upBody: 'rgba(28,180,143,.26)', downBody: 'rgba(222,73,105,.3)',
    volUp: 'rgba(47,183,146,.42)', volDown: 'rgba(234,97,128,.42)',
    ema: '#f4c57a', sma: '#96b7f1', bb: '#a99df4', rsi: '#bca4ff',
    last: '#d7ac72', lastText: '#131922', drawing: '#e7bd89',
    hoverBg: '#1c2a39', hoverText: '#eaf0f7', guide: '#8da1bb'
  },
  synth: {
    bg: '#0e0a1e', axis: '#17112c', grid: '#302446',
    labels: '#ab9ac7', cross: '#ac95d3', up: '#54e8e2', down: '#ff7caf',
    upBody: 'rgba(49,177,180,.24)', downBody: 'rgba(220,66,127,.31)',
    volUp: 'rgba(85,218,212,.38)', volDown: 'rgba(253,118,176,.37)',
    ema: '#ffcb91', sma: '#b3a4ff', bb: '#d89ae9', rsi: '#fe9ed4',
    last: '#c7a5ff', lastText: '#171125', drawing: '#feb9d1',
    hoverBg: '#2a2042', hoverText: '#f1e8ff', guide: '#b4a3d2'
  },
  verdigris: {
    bg: '#071614', axis: '#0c211d', grid: '#204037',
    labels: '#8eafa7', cross: '#7ebcad', up: '#9ded9e', down: '#ff9c7a',
    upBody: 'rgba(120,203,115,.26)', downBody: 'rgba(230,113,73,.29)',
    volUp: 'rgba(147,220,148,.43)', volDown: 'rgba(241,139,107,.39)',
    ema: '#ead588', sma: '#78c5c2', bb: '#a0aaed', rsi: '#b9d395',
    last: '#d9d18f', lastText: '#0c241b', drawing: '#e4d5a8',
    hoverBg: '#16362c', hoverText: '#e1fff0', guide: '#9bcbbb'
  }
});
