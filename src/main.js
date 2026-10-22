import { BinanceStream, BinanceDepthStream, checkMarket, fetchCandles } from './binance.js';
import { KrakenStream, checkKraken, fetchKrakenCandles, KRAKEN_INTERVALS } from './kraken.js';
import { CoinbaseStream, checkCoinbase, fetchCoinbaseCandles, COINBASE_INTERVALS } from './coinbase.js';
import { CandleChart } from './chart.js';
import { formatCompact, formatPrice, INTERVALS } from './core.js';
import { makeDemoCandles, makeDemoDepth, nextDemoCandle } from './demo.js';
import { LiquidityHeatmap } from './heatmap.js';
import { LiquidityArchive, liquiditySeriesKey, ARCHIVE_POLICY } from './liquidity-archive.js';
import { normalTheme, sanitizeFavorites, MARKET_PRESETS } from './workspace.js';
import { mountWorkspace } from './workspace-ui.js';
import { mountChartGrid } from './chart-grid.js';
import { normalizeGridLayout, normalizeGridPanes } from './chart-grid-core.js';

const el = (id) => document.getElementById(id);
const STORAGE_KEY = 'bitcornwisdom:settings:v1';
const DRAWINGS_PREFIX = 'bitcornwisdom:drawings:v1:';

function readStored(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : JSON.parse(stored);
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be disabled. */ }
}

const url = new URL(location.href);
const previous = readStored(STORAGE_KEY, {}) || {};
const settings = {
  market: url.searchParams.get('market') || previous.market || 'spot',
  symbol: (url.searchParams.get('symbol') || previous.symbol || 'BTCUSDT').toUpperCase(),
  interval: url.searchParams.get('interval') || previous.interval || '5m',
  demo: url.searchParams.has('demo') ? url.searchParams.get('demo') === '1' : Boolean(previous.demo),
  showEMA: previous.showEMA ?? true,
  showSMA: previous.showSMA ?? false,
  logarithmic: previous.logarithmic ?? false,
  showBB: previous.showBB ?? false,
  showRSI: previous.showRSI ?? false,
  theme: normalTheme(previous.theme),
  favorites: previous.favorites === undefined ? MARKET_PRESETS.slice(0, 3) : sanitizeFavorites(previous.favorites),
  watchlistVisible: previous.watchlistVisible ?? !window.matchMedia('(max-width:1110px)').matches,
  depthVisible: previous.depthVisible ?? true,
  chartLayout: normalizeGridLayout(previous.chartLayout),
  gridPanes: normalizeGridPanes(previous.gridPanes),
  gridLinkTime: previous.gridLinkTime ?? true,
  gridLinkCursor: previous.gridLinkCursor ?? true
};

try { validateSelection(settings.market, settings.symbol, settings.interval); }
catch { settings.market = 'spot'; settings.symbol = 'BTCUSDT'; settings.interval = '5m'; }

function validateSelection(market, symbol, interval) {
  if (market === 'kraken') checkKraken(symbol, interval);
  else if (market === 'coinbase') checkCoinbase(symbol, interval);
  else checkMarket(market, symbol, interval);
}

function updateTimeframeOptions() {
  for (const option of el('timeframe').options) {
    option.disabled = settings.market === 'kraken' ?
      !Object.hasOwn(KRAKEN_INTERVALS, option.value) : settings.market === 'coinbase' ?
      !Object.hasOwn(COINBASE_INTERVALS, option.value) : false;
  }
}

let chartGrid = null;
const chart = new CandleChart(el('candle-chart'), {
  onDrawingsChange: (drawings) => {
    writeStored(drawingKey(), drawings);
    updateDrawingControls();
  },
  onCursor: (source, time) => chartGrid?.broadcastCursor(source, time),
  onViewportChange: (source, view) => chartGrid?.broadcastViewport(source, view)
});
let workspaceUI = null;
const heatmap = new LiquidityHeatmap(el('liquidity-heatmap'), {
  onChange: (state) => updateLiquidityControls(state)
});
const archive = new LiquidityArchive();
chart.setOptions({
  showEMA: settings.showEMA, showSMA: settings.showSMA,
  showBB: settings.showBB, showRSI: settings.showRSI,
  theme: settings.theme, logarithmic: settings.logarithmic
});

let session = 0;
let stream = null;
let depthStream = null;
let controller = null;
let resyncController = null;
let historyController = null;
let demoTimer = null;
let lastBookRender = 0;
let lastTradeRender = 0;
let trades = [];
let demoTick = 0;
let activeLiquiditySeries = null;
let liquidityStorageFailure = null;
let liquidityReplayTimer = null;

function formatRecordedTime(ms) {
  return ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'Collecting observations…';
}

function updateLiquidityControls(state) {
  const count = state.count;
  const scrubber = el('liquidity-scrubber');
  scrubber.max = String(Math.max(0, count - 1));
  scrubber.value = String(state.index);
  scrubber.disabled = count < 2;
  el('liquidity-count').textContent = count.toLocaleString('en-US') + ' samples';
  el('liquidity-time').textContent = (state.mode === 'replay' ? 'Replay · ' : 'Observed · ') +
    formatRecordedTime(state.at);
  el('liquidity-replay').disabled = count < 2;
  el('liquidity-play').disabled = count < 2;
  el('liquidity-play').textContent = liquidityReplayTimer !== null ? 'Ⅱ Pause' : '▶ Play';
  el('liquidity-live').classList.toggle('active', state.mode === 'live');
  el('liquidity-live').setAttribute('aria-pressed', String(state.mode === 'live'));
  el('liquidity-replay').classList.toggle('active', state.mode === 'replay');
  el('liquidity-replay').setAttribute('aria-pressed', String(state.mode === 'replay'));
}

function archiveStatus(note) {
  el('liquidity-storage').textContent = note;
}

function archiveFailed(error) {
  liquidityStorageFailure = error.message || String(error);
  archiveStatus('Memory only · local archive unavailable: ' + liquidityStorageFailure);
  console.warn('Liquidity archive:', error);
}

function stopLiquidityPlayback() {
  if (liquidityReplayTimer !== null) clearInterval(liquidityReplayTimer);
  liquidityReplayTimer = null;
  updateLiquidityControls(heatmap.getState());
}

function startLiquidityPlayback() {
  stopLiquidityPlayback();
  if (heatmap.history.length < 2) return;
  if (heatmap.mode !== 'replay') heatmap.seek(Math.max(0, heatmap.history.length - 160));
  const speed = Number(el('liquidity-speed').value) || 4;
  liquidityReplayTimer = setInterval(() => {
    if (heatmap.replayIndex >= heatmap.history.length - 1) {
      stopLiquidityPlayback();
      return;
    }
    heatmap.seek(heatmap.replayIndex + 1);
  }, Math.max(60, Math.round(1000 / speed)));
  updateLiquidityControls(heatmap.getState());
}

function activateLiquidityArchive(current) {
  const series = liquiditySeriesKey(settings.market, settings.symbol, settings.demo);
  activeLiquiditySeries = series;
  liquidityStorageFailure = null;
  heatmap.clear(series);
  archiveStatus('IndexedDB · restoring local samples…');
  archive.load(series).then((samples) => {
    if (session !== current || activeLiquiditySeries !== series) return;
    heatmap.restore(samples, series);
    archiveStatus('IndexedDB active · sampled depth · 24h age limit');
    archive.prune().catch((error) => {
      if (session === current) archiveFailed(error);
    });
  }).catch((error) => {
    if (session === current && activeLiquiditySeries === series) archiveFailed(error);
  });
}

function captureLiquidity(book, price) {
  const sample = heatmap.ingest(book, price);
  if (!sample || liquidityStorageFailure) return;
  const series = activeLiquiditySeries;
  archive.save(sample).catch((error) => {
    if (series === activeLiquiditySeries) archiveFailed(error);
  });
}

function drawingKey() {
  return DRAWINGS_PREFIX + [settings.market, settings.symbol, settings.interval].join(':');
}

function persist() {
  writeStored(STORAGE_KEY, settings);
  const next = new URL(location.href);
  next.searchParams.set('market', settings.market);
  next.searchParams.set('symbol', settings.symbol);
  next.searchParams.set('interval', settings.interval);
  if (settings.demo) next.searchParams.set('demo', '1');
  else next.searchParams.delete('demo');
  history.replaceState(null, '', next);
}

function updateButtons() {
  for (const [id, active] of [
    ['ema-toggle', settings.showEMA],
    ['sma-toggle', settings.showSMA],
    ['log-toggle', settings.logarithmic],
    ['bb-toggle', settings.showBB],
    ['rsi-toggle', settings.showRSI]
  ]) {
    const button = el(id);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  updateTimeframeOptions();
  el('demo-toggle').textContent = settings.demo ? 'Return to live feed' : 'Use offline demo';
}

function updateDrawingControls() {
  el('drawing-count').textContent = String(chart.drawings.length);
  el('drawing-tool').value = chart.tool;
}

function applyDrawingTool(tool) {
  chart.setTool(tool);
  updateDrawingControls();
  el('candle-chart').focus({ preventScroll: true });
}

function setStatus(status, description = '') {
  const messages = {
    starting: 'Starting…', connecting: 'Connecting feed…', live: 'LIVE',
    disrupted: 'Feed interrupted', reconnecting: 'Reconnecting…',
    loading: 'Loading history…', demo: 'OFFLINE DEMO', error: 'DATA ERROR'
  };
  const dot = el('status-dot');
  dot.className = 'status-dot';
  if (status === 'live') dot.classList.add('live');
  else if (status === 'demo') dot.classList.add('demo');
  else if (status === 'error' || status === 'disrupted') dot.classList.add('error');
  el('connection-label').textContent = description || messages[status] || status;
}

function updateHeader() {
  chartGrid?.updatePrimaryLabel();
  const quote = ['USDT', 'USDC', 'BUSD', 'BTC', 'USD', 'ETH'].find((q) =>
    settings.symbol.endsWith(q) && settings.symbol.length > q.length);
  const base = quote ? settings.symbol.slice(0, -quote.length) : settings.symbol;
  el('pair-title').textContent = quote ? base + ' / ' + quote : settings.symbol;
  const venue = settings.market === 'kraken' ? 'KRAKEN SPOT' :
    settings.market === 'coinbase' ? 'COINBASE EXCHANGE' :
    (settings.market === 'spot' ? 'BINANCE SPOT' : 'BINANCE USDⓈ-M');
  el('market-subtitle').textContent = venue + ' · UTC' + (settings.demo ? ' · DEMO DATA' : '');
  el('book-pair').textContent = settings.symbol;
  workspaceUI?.refresh();
  el('market-note').textContent = settings.demo ?
    'Simulated prices · for interaction testing only' :
    'Public ' + (settings.market === 'kraken' ? 'Kraken' :
      settings.market === 'coinbase' ? 'Coinbase Exchange' : 'Binance') + ' feeds · read only';
}

function setPrice(price) {
  el('last-price').textContent = formatPrice(price);
  workspaceUI?.setQuote(price);
  const first = chart.candles[0], last = chart.candles.at(-1);
  if (first && last && first.close > 0) {
    const change = 100 * (last.close - first.open) / first.open;
    const label = el('price-change');
    label.textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + '% in loaded window';
    label.style.color = change >= 0 ? '#8acc9d' : '#e2828b';
  }
}

function showLoading(enabled) {
  el('chart-loading').hidden = !enabled;
  if (enabled) el('chart-error').hidden = true;
}

function showError(error) {
  const box = el('chart-error');
  box.textContent = (error?.message || String(error)) +
    '. Check your exchange/network access, or use the offline demo below.';
  box.hidden = false;
  showLoading(false);
  setStatus('error');
}

function clearTapeAndBook() {
  trades = [];
  lastTradeRender = 0;
  lastBookRender = 0;
  el('asks').textContent = 'Waiting for depth…';
  el('bids').textContent = '';
  el('spread').textContent = '—';
  el('book-status').textContent = 'Synchronizing book…';
  el('trades').textContent = 'Waiting for trades…';
  heatmap.clear();
}

function renderBook(book) {
  if (!book.bids.length || !book.asks.length) return;
  const bids = book.bids.slice(0, 10);
  const asks = book.asks.slice(0, 10);
  const maxQty = Math.max(1e-10, ...bids.map((row) => row[1]), ...asks.map((row) => row[1]));
  function rows(levels, side) {
    return levels.map(([price, quantity]) => {
      const width = Math.min(100, quantity / maxQty * 100).toFixed(2);
      return '<div class="book-row ' + side + '"><span class="bar" style="width:' + width +
        '%"></span><span>' + formatPrice(price) + '</span><span>' +
        formatCompact(quantity) + '</span></div>';
    }).join('');
  }
  el('asks').innerHTML = rows(asks.reverse(), 'ask');
  el('bids').innerHTML = rows(bids, 'bid');
  const spread = Math.max(0, book.asks[0][0] - book.bids[0][0]);
  el('spread').textContent = formatPrice(spread) + ' (' +
    (100 * spread / book.asks[0][0]).toFixed(4) + '%)';
  el('book-status').textContent = book.source === 'checksum-verified' ? 'Kraken checksum-verified L2 · 25 levels' :
    book.source === 'sequenced-depth' ? 'Binance synchronized L2 · 1,000 levels max' :
    book.source === 'coinbase-level2' ? 'Coinbase snapshot-fed L2 · 1,000 levels max' :
    'Offline sample book';
}

function addTrade(trade) {
  if (!Number.isFinite(trade.price) || !Number.isFinite(trade.quantity)) return;
  trades.unshift(trade);
  if (trades.length > 40) trades.pop();
  const now = Date.now();
  if (now - lastTradeRender < 280) return;
  lastTradeRender = now;
  el('trades').innerHTML = trades.slice(0, 30).map((row) =>
    '<div class="trade-row ' + row.side + '"><span>' + formatPrice(row.price) +
    '</span><span>' + formatCompact(row.quantity) + '</span><span>' +
    new Date(row.time).toISOString().slice(11, 19) + '</span></div>').join('');
}

function stopFeed() {
  session += 1;
  stopLiquidityPlayback();
  if (controller) { controller.abort(); controller = null; }
  if (resyncController) { resyncController.abort(); resyncController = null; }
  if (historyController) { historyController.abort(); historyController = null; }
  chart.onHistoryNeeded = null;
  if (stream) { stream.close(); stream = null; }
  if (depthStream) { depthStream.close(); depthStream = null; }
  if (demoTimer !== null) { clearInterval(demoTimer); demoTimer = null; }
}

function startDemo(version) {
  const candles = makeDemoCandles(settings.interval, 900);
  if (version !== session) return;
  chart.setCandles(candles, settings.interval);
  chartGrid?.syncFromPrimary();
  el('chart-loading').hidden = true;
  setStatus('demo');
  setPrice(candles.at(-1).close);
  updateHeader();
  demoTick = 0;
  const onTick = () => {
    if (session !== version) return;
    const candle = nextDemoCandle(chart.candles.at(-1), settings.interval, demoTick++);
    chart.updateCandle(candle);
    setPrice(candle.close);
    const time = Date.now();
    const book = makeDemoDepth(candle.close, time);
    renderBook(book);
    captureLiquidity(book, candle.close);
    addTrade({ time, price: candle.close, quantity: 0.02 + Math.abs(Math.sin(demoTick) * .8),
      side: demoTick % 2 ? 'buy' : 'sell' });
  };
  onTick();
  demoTimer = setInterval(onTick, 1100);
}

async function loadMarket() {
  stopFeed();
  // stopFeed increments generation; use the resulting value.
  const current = session;
  chartGrid?.refreshMode();
  el('market').value = settings.market;
  el('symbol').value = settings.symbol;
  el('timeframe').value = settings.interval;
  updateHeader();
  updateButtons();
  persist();
  clearTapeAndBook();
  activateLiquidityArchive(current);
  chart.setCandles([], settings.interval);
  chart.onHistoryNeeded = settings.demo || settings.market === 'kraken' ? null : async () => {
    if (session !== current || !chart.candles.length) return false;
    if (historyController) return null;
    const ac = new AbortController();
    historyController = ac;
    const earliest = chart.candles[0].time;
    const market = settings.market;
    const symbol = settings.symbol;
    const interval = settings.interval;
    try {
      const older = market === 'coinbase' ?
        await fetchCoinbaseCandles(symbol, interval, ac.signal, fetch, earliest) :
        await fetchCandles(market, symbol, interval, ac.signal, 1000, fetch, earliest);
      if (session !== current || ac.signal.aborted) return null;
      const count = chart.prependHistory(older);
      if (count > 0) {
        el('market-note').textContent = 'Historical candles loaded: ' + chart.candles.length;
        return true;
      }
      return false;
    } catch (error) {
      if (!ac.signal.aborted) console.warn('Older OHLCV request failed:', error);
      return null;
    } finally {
      if (historyController === ac) historyController = null;
    }
  };
  chart.setDrawings(readStored(drawingKey(), []));
  updateDrawingControls();
  el('last-price').textContent = '—';
  el('price-change').textContent = 'OHLCV';
  showLoading(true);
  if (settings.demo) {
    startDemo(current);
    return;
  }
  setStatus('loading');
  controller = new AbortController();
  try {
    const data = settings.market === 'kraken' ?
      await fetchKrakenCandles(settings.symbol, settings.interval, controller.signal) :
      settings.market === 'coinbase' ?
      await fetchCoinbaseCandles(settings.symbol, settings.interval, controller.signal) :
      await fetchCandles(settings.market, settings.symbol, settings.interval, controller.signal);
    if (session !== current) return;
    if (data.length === 0) throw new Error('Exchange returned no candles');
    chart.setCandles(data, settings.interval);
    chartGrid?.syncFromPrimary();
    setPrice(data.at(-1).close);
    showLoading(false);
    const onDepth = (book) => {
      if (session !== current) return;
      const latest = chart.candles.at(-1);
      const center = latest?.close ?? ((book.bids[0][0] + book.asks[0][0]) / 2);
      captureLiquidity(book, center);
      if (Date.now() - lastBookRender > 240) {
        lastBookRender = Date.now();
        renderBook(book);
      }
    };
    const callbacks = {
      onStatus: (status) => { if (session === current) setStatus(status); },
      onCandle: (candle) => {
        if (session !== current) return;
        chart.updateCandle(candle);
        setPrice(candle.close);
      },
      onTrade: (trade) => { if (session === current) addTrade(trade); },
      onDepth,
      onBookStatus: (status, reason) => {
        if (session !== current || status === 'live') return;
        el('book-status').textContent = 'Book syncing' + (reason ? ': ' + reason : '…');
      },
      onError: (error) => console.warn('Market frame rejected:', error)
    };
    if (settings.market === 'kraken') {
      stream = new KrakenStream(settings.symbol, settings.interval, callbacks).start();
    } else if (settings.market === 'coinbase') {
      callbacks.onFeedWarning = (warning) => {
        if (session !== current) return;
        el('market-note').textContent = warning ?
          'Coinbase data warning: ' + warning : 'Public Coinbase Exchange feeds · read only';
      };
      callbacks.onResyncHistory = async () => {
        if (session !== current) return;
        if (resyncController) resyncController.abort();
        const active = new AbortController();
        resyncController = active;
        try {
          const fresh = await fetchCoinbaseCandles(settings.symbol, settings.interval, active.signal);
          if (session !== current || active.signal.aborted) return;
          if (fresh.length) {
            chart.replaceRecentHistory(fresh);
            stream?.seedHistory(fresh);
            setPrice(fresh.at(-1).close);
            callbacks.onFeedWarning?.(null);
          }
        } catch (error) {
          if (!active.signal.aborted) console.warn('Coinbase candle refresh failed', error);
        } finally {
          if (resyncController === active) resyncController = null;
        }
      };
      stream = new CoinbaseStream(settings.symbol, settings.interval, callbacks);
      stream.seedHistory(data);
      stream.start();
    } else {
      stream = new BinanceStream(settings.market, settings.symbol, settings.interval, callbacks).start();
      depthStream = new BinanceDepthStream(settings.market, settings.symbol, callbacks).start();
    }
  } catch (error) {
    if (session === current) showError(error);
  } finally {
    if (session === current) controller = null;
  }
}

el('market-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const symbol = el('symbol').value.trim().toUpperCase();
  const market = el('market').value;
  try {
    validateSelection(market, symbol, settings.interval);
    settings.symbol = symbol;
    settings.market = market;
    loadMarket();
  } catch (error) {
    showError(error);
  }
});
el('market').addEventListener('change', () => {
  const nextMarket = el('market').value;
  if (['kraken', 'coinbase'].includes(nextMarket) &&
      !['kraken', 'coinbase'].includes(settings.market) && settings.symbol === 'BTCUSDT')
    settings.symbol = 'BTCUSD';
  else if (['spot', 'futures'].includes(nextMarket) &&
      ['kraken', 'coinbase'].includes(settings.market) && settings.symbol === 'BTCUSD')
    settings.symbol = 'BTCUSDT';
  settings.market = nextMarket;
  if ((settings.market === 'kraken' && !Object.hasOwn(KRAKEN_INTERVALS, settings.interval)) ||
      (settings.market === 'coinbase' && !Object.hasOwn(COINBASE_INTERVALS, settings.interval)))
    settings.interval = '5m';
  loadMarket();
});
el('timeframe').addEventListener('change', () => {
  const interval = el('timeframe').value;
  if (!INTERVALS.includes(interval)) return;
  settings.interval = interval;
  loadMarket();
});

function toggleIndicator(key) {
  if (!['showEMA', 'showSMA', 'showBB', 'showRSI', 'logarithmic'].includes(key)) return;
  settings[key] = !settings[key];
  chart.setOptions({ [key]: settings[key] });
  persist();
  updateButtons();
}

for (const [id, key] of [
  ['ema-toggle', 'showEMA'], ['sma-toggle', 'showSMA'],
  ['bb-toggle', 'showBB'], ['rsi-toggle', 'showRSI'],
  ['log-toggle', 'logarithmic']
]) {
  el(id).addEventListener('click', () => toggleIndicator(key));
}
el('drawing-tool').addEventListener('change', () => applyDrawingTool(el('drawing-tool').value));
el('delete-drawing').addEventListener('click', () => chart.removeSelected());
el('undo-tool').addEventListener('click', () => chart.undoDrawing());
el('reset-view').addEventListener('click', () => chart.resetView());
el('demo-toggle').addEventListener('click', () => {
  settings.demo = !settings.demo;
  loadMarket();
});

el('liquidity-replay').addEventListener('click', () => {
  stopLiquidityPlayback();
  if (heatmap.history.length >= 2) heatmap.seek(Math.max(0, heatmap.history.length - 160));
});
el('liquidity-live').addEventListener('click', () => {
  stopLiquidityPlayback();
  heatmap.goLive();
});
el('liquidity-play').addEventListener('click', () => {
  if (liquidityReplayTimer !== null) stopLiquidityPlayback();
  else startLiquidityPlayback();
});
el('liquidity-speed').addEventListener('change', () => {
  if (liquidityReplayTimer !== null) startLiquidityPlayback();
});
el('liquidity-scrubber').addEventListener('input', () => {
  const requestedIndex = Number(el('liquidity-scrubber').value);
  stopLiquidityPlayback();
  heatmap.seek(requestedIndex);
});
el('liquidity-clear').addEventListener('click', async () => {
  if (!activeLiquiditySeries || !window.confirm(
    'Erase locally recorded liquidity for this exchange and symbol?'
  )) return;
  stopLiquidityPlayback();
  const series = activeLiquiditySeries;
  const current = session;
  try {
    await archive.clearSeries(series);
    if (session !== current || series !== activeLiquiditySeries) return;
    heatmap.clear(series);
    archiveStatus('Local history erased · recording fresh observations');
  } catch (error) {
    if (session === current) archiveFailed(error);
  }
});
window.addEventListener('beforeunload', () => {
  stopFeed();
  chart.destroy();
  heatmap.destroy();
  chartGrid?.destroy();
  archive.close();
});

chartGrid = mountChartGrid({
  root: el('chart-frame'), primary: chart, settings, persist
});
workspaceUI = mountWorkspace({
  settings, chart, persist, loadMarket, validateSelection,
  setIndicator: toggleIndicator, setDrawingTool: applyDrawingTool,
  onThemeChange: (theme) => chartGrid?.setTheme(theme),
  onSetLayout: (count) => chartGrid?.setLayout(count),
  onToggleTimeLink: () => chartGrid?.setLinkTime(!settings.gridLinkTime),
  onToggleCursorLink: () => chartGrid?.setLinkCursor(!settings.gridLinkCursor)
});
loadMarket();
