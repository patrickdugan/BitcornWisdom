import { CandleChart } from './chart.js';
import { BinanceStream, fetchCandles } from './binance.js';
import { KrakenStream, fetchKrakenCandles } from './kraken.js';
import { CoinbaseStream, fetchCoinbaseCandles } from './coinbase.js';
import { makeDemoCandles, nextDemoCandle } from './demo.js';
import { formatPrice } from './core.js';
import { MARKET_NAMES, normalTheme, symbolLabel } from './workspace.js';
import {
  GRID_MODES, GRID_MARKETS, GRID_INTERVALS, normalizeGridCell,
  loadGridLayout, saveGridLayout, normalizeGridLayout, normalizeSplit,
  normalizeGridPresetName, loadGridPresets, saveGridPresets,
  exportGridWorkspace, parseGridWorkspace, GRID_PRESET_LIMIT, GRID_WORKSPACE_MAX_BYTES
} from './grid-model.js';
import { getUTCViewport, applyUTCViewport } from './grid-time.js';

const byId = (id) => document.getElementById(id);
const grid = byId('chart-grid');
let layout = loadGridLayout(localStorage);
const initial = new URL(location.href);
if (initial.searchParams.has('demo')) layout.demo = initial.searchParams.get('demo') === '1';
const requestedMode = Number(initial.searchParams.get('mode'));
if (initial.searchParams.has('mode') && GRID_MODES.includes(requestedMode)) layout.mode = requestedMode;
let fallbackTheme = 'noir';
try { fallbackTheme = JSON.parse(localStorage.getItem('bitcornwisdom:settings:v1') || '{}')?.theme; } catch {}
let theme = normalTheme(localStorage.getItem('bitcornwisdom:grid:theme') || fallbackTheme);
document.documentElement.dataset.theme = theme;
byId('grid-theme').value = theme;
byId('grid-mode').value = String(layout.mode);
byId('grid-sync-crosshair').checked = layout.syncCrosshair;
byId('grid-sync-range').checked = layout.syncRange;
byId('grid-demo').checked = layout.demo;
let cells = [];
let presets = loadGridPresets(localStorage);
let syncPending = false;

const storeLayout = () => {
  try { layout = saveGridLayout(localStorage, layout); } catch (error) {
    console.warn('Unable to persist chart layout:', error);
  }
};

function status() {
  const live = cells.filter((c) => c.state === 'live' || c.state === 'demo').length;
  byId('grid-status').textContent = live + ' / ' + cells.length + ' FEEDS ACTIVE';
}

function emitCrosshair(source, candle) {
  if (!layout.syncCrosshair || !candle) return;
  for (const cell of cells) {
    if (cell !== source) cell.chart?.setSyncedTime(candle.time);
  }
}
function clearCrosshair(source) {
  if (!layout.syncCrosshair) return;
  for (const cell of cells) {
    if (cell !== source) cell.chart?.setSyncedTime(null);
  }
}
function syncRange(source) {
  if (!layout.syncRange || syncPending || !source.chart) return;
  syncPending = true;
  requestAnimationFrame(() => {
    syncPending = false;
    if (!cells.includes(source)) return;
    const window = getUTCViewport(source.chart);
    if (!window) return;
    for (const cell of cells) {
      if (cell !== source && cell.chart) applyUTCViewport(cell.chart, window);
    }
  });
}
function alignLoadedCell(cell) {
  if (!layout.syncRange) return;
  const peer = cells.find((other) => other !== cell && other.chart?.candles.length);
  const window = peer && getUTCViewport(peer.chart);
  if (window) applyUTCViewport(cell.chart, window);
}

function demoCandles(selection) {
  // The offline screen is synthetic, with distinct price magnitudes by asset.
  const base = selection.symbol.startsWith('ETH') ? 3200 :
    selection.symbol.startsWith('SOL') ? 160 :
    selection.symbol.startsWith('BTC') ? 72000 : 400;
  const rows = makeDemoCandles(selection.interval, 900);
  const scale = base / 72000;
  return rows.map((row) => ({
    time: row.time, open: row.open * scale, high: row.high * scale,
    low: row.low * scale, close: row.close * scale, volume: row.volume
  }));
}

function marketCandles(c, signal) {
  const { market, symbol, interval } = c.selection;
  if (market === 'kraken') return fetchKrakenCandles(symbol, interval, signal);
  if (market === 'coinbase') return fetchCoinbaseCandles(symbol, interval, signal);
  return fetchCandles(market, symbol, interval, signal);
}
function marketStream(c, callbacks) {
  const { market, symbol, interval } = c.selection;
  if (market === 'kraken') return new KrakenStream(symbol, interval, callbacks, undefined, {chartOnly:true});
  if (market === 'coinbase') return new CoinbaseStream(symbol, interval, callbacks, undefined, {chartOnly:true});
  return new BinanceStream(market, symbol, interval, callbacks);
}

function stopCell(cell) {
  cell.generation++;
  if (cell.controller) cell.controller.abort();
  cell.controller = null;
  cell.stream?.close();
  cell.stream = null;
  if (cell.demoTimer !== null) clearInterval(cell.demoTimer);
  cell.demoTimer = null;
  cell.state = 'stopped';
}

function setCellStatus(cell, message, state) {
  cell.state = state;
  cell.stateText.textContent = message;
  status();
}

async function loadCell(cell) {
  stopCell(cell);
  const version = cell.generation;
  const { selection } = cell;
  cell.error.hidden = true;
  cell.chart.setCandles([], selection.interval);
  cell.priceText.textContent = '—';
  cell.title.textContent = symbolLabel(selection.symbol);
  cell.venueText.textContent = MARKET_NAMES[selection.market];
  cell.bottom.textContent = selection.interval.toUpperCase() + ' · UTC';
  setCellStatus(cell, 'LOADING HISTORY', 'loading');

  if (layout.demo) {
    const candles = demoCandles(selection);
    if (version !== cell.generation) return;
    cell.chart.setCandles(candles, selection.interval);
    alignLoadedCell(cell);
    cell.priceText.textContent = formatPrice(candles.at(-1).close);
    setCellStatus(cell, 'SYNTHETIC DEMO', 'demo');
    let tick = 0;
    cell.demoTimer = setInterval(() => {
      if (version !== cell.generation) return;
      const latest = cell.chart.candles.at(-1);
      if (!latest) return;
      const candle = nextDemoCandle(latest, selection.interval, tick++);
      cell.chart.updateCandle(candle);
      cell.priceText.textContent = formatPrice(candle.close);
    }, 1300);
    return;
  }

  const controller = new AbortController();
  cell.controller = controller;
  try {
    const candles = await marketCandles(cell, controller.signal);
    if (version !== cell.generation || controller.signal.aborted) return;
    if (!candles.length) throw new Error('No candles available for this market');
    cell.chart.setCandles(candles, selection.interval);
    alignLoadedCell(cell);
    cell.priceText.textContent = formatPrice(candles.at(-1).close);
    const callbacks = {
      onStatus: (state) => {
        if (version !== cell.generation) return;
        setCellStatus(cell, state.toUpperCase(), state);
      },
      onCandle: (candle) => {
        if (version !== cell.generation) return;
        cell.chart.updateCandle(candle);
        cell.priceText.textContent = formatPrice(candle.close);
      },
      onTrade: () => {},
      onDepth: () => {},
      onError: (error) => {
        if (version === cell.generation) console.warn('Grid feed', selection.symbol, error);
      },
      onResyncHistory: () => {
        if (version === cell.generation) loadCell(cell);
      }
    };
    cell.stream = marketStream(cell, callbacks);
    if (selection.market === 'coinbase') cell.stream.seedHistory(candles);
    cell.stream.start();
  } catch (error) {
    if (version !== cell.generation || controller.signal.aborted) return;
    cell.error.textContent = String(error.message || error) + ' · Try offline demo';
    cell.error.hidden = false;
    setCellStatus(cell, 'FEED UNAVAILABLE', 'error');
  } finally {
    if (cell.controller === controller) cell.controller = null;
  }
}

function selector(list, selected, className, ariaLabel) {
  const node = document.createElement('select');
  node.className = className;
  node.setAttribute('aria-label', ariaLabel);
  for (const [value, label] of list) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    node.append(option);
  }
  node.value = selected;
  return node;
}

function newCell(index) {
  const selection = normalizeGridCell(layout.cells[index], index);
  const article = document.createElement('article');
  article.className = 'grid-cell';
  article.innerHTML = '<div class="grid-cell-head"></div>' +
    '<div class="grid-cell-status"><span>STATUS</span><b>PREPARING</b></div>' +
    '<div class="grid-chart-surface"><canvas tabindex="0" aria-label="Interactive grid candlestick chart"></canvas>' +
    '<div class="grid-cell-error" hidden></div></div>' +
    '<div class="grid-cell-foot"><span class="grid-bottom-interval"></span><span>PUBLIC FEED · READ ONLY</span></div>';
  const header = article.querySelector('.grid-cell-head');
  const number = document.createElement('span');
  number.className = 'grid-cell-number';
  number.textContent = String(index + 1).padStart(2, '0');
  const identity = document.createElement('span');
  identity.className = 'grid-cell-title';
  const title = document.createElement('strong');
  const venueText = document.createElement('span');
  identity.append(title, venueText);
  const market = selector(GRID_MARKETS.map((v) => [v, MARKET_NAMES[v]]),
    selection.market, 'grid-market', 'Exchange for chart ' + (index + 1));
  const symbol = document.createElement('input');
  symbol.className = 'grid-pair';
  symbol.value = selection.symbol;
  symbol.maxLength = 24;
  symbol.setAttribute('aria-label', 'Symbol for chart ' + (index + 1));
  const interval = selector(GRID_INTERVALS[selection.market].map((v) => [v, v]),
    selection.interval, 'grid-interval', 'Interval for chart ' + (index + 1));
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'grid-cell-load';
  go.textContent = 'GO ↗';
  const priceText = document.createElement('span');
  priceText.className = 'grid-chart-price';
  header.append(number, identity, market, symbol, interval, go, priceText);
  grid.append(article);
  const canvas = article.querySelector('canvas');
  const cell = {
    generation: 0, controller: null, stream: null, demoTimer: null,
    state: 'starting', article, title, venueText,
    selection, market, symbol, interval, priceText,
    stateText: article.querySelector('.grid-cell-status b'),
    bottom: article.querySelector('.grid-bottom-interval'),
    error: article.querySelector('.grid-cell-error')
  };
  const chart = new CandleChart(canvas, {
    onHover: (candle) => emitCrosshair(cell, candle)
  });
  chart.setOptions({ theme });
  cell.chart = chart;
  canvas.addEventListener('pointerleave', () => clearCrosshair(cell));
  canvas.addEventListener('wheel', () => syncRange(cell), { passive: true });
  canvas.addEventListener('pointermove', () => {
    if (chart.drag) syncRange(cell);
  });
  canvas.addEventListener('keyup', () => syncRange(cell));

  function updateIntervals() {
    const possible = GRID_INTERVALS[market.value];
    interval.replaceChildren();
    for (const v of possible) {
      const option = document.createElement('option');
      option.value = v;
      option.textContent = v;
      interval.append(option);
    }
    interval.value = possible.includes(selection.interval) ? selection.interval : '5m';
  }
  function submit() {
    const next = normalizeGridCell({
      market: market.value, symbol: symbol.value, interval: interval.value
    }, index);
    if (next.symbol !== symbol.value.trim().toUpperCase()) {
      cell.error.textContent = 'Invalid symbol. Use letters and digits only.';
      cell.error.hidden = false;
      return;
    }
    cell.selection = next;
    layout.cells[index] = next;
    storeLayout();
    loadCell(cell);
  }
  go.addEventListener('click', submit);
  symbol.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });
  market.addEventListener('change', () => {
    const old = selection.market;
    selection.market = market.value;
    if (['coinbase','kraken'].includes(market.value) && symbol.value === 'BTCUSDT')
      symbol.value = 'BTCUSD';
    else if (['spot','futures'].includes(market.value) && symbol.value === 'BTCUSD')
      symbol.value = 'BTCUSDT';
    updateIntervals();
    submit();
  });
  interval.addEventListener('change', submit);
  loadCell(cell);
  return cell;
}

function applySplitterStyles() {
  grid.style.setProperty('--grid-col-ratio', layout.splitX + '%');
  grid.style.setProperty('--grid-row-ratio', layout.splitY + '%');
}
function addDivider(axis) {
  const key = axis === 'x' ? 'splitX' : 'splitY';
  const cssKey = axis === 'x' ? '--grid-col-ratio' : '--grid-row-ratio';
  const divider = document.createElement('div');
  divider.className = 'grid-divider grid-divider--' + (axis === 'x' ? 'col' : 'row');
  divider.tabIndex = 0;
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-orientation', axis === 'x' ? 'vertical' : 'horizontal');
  divider.setAttribute('aria-label', axis === 'x' ? 'Resize chart columns' : 'Resize chart rows');
  divider.setAttribute('aria-valuemin', '20');
  divider.setAttribute('aria-valuemax', '80');
  let pointerId = null;
  function update(value, persist = false) {
    layout[key] = normalizeSplit(value);
    grid.style.setProperty(cssKey, layout[key] + '%');
    divider.setAttribute('aria-valuenow', String(layout[key]));
    if (persist) storeLayout();
  }
  function fromPointer(event) {
    const bounds = grid.getBoundingClientRect();
    const value = axis === 'x' ?
      (event.clientX - bounds.left) / bounds.width * 100 :
      (event.clientY - bounds.top) / bounds.height * 100;
    return value;
  }
  divider.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    pointerId = event.pointerId;
    divider.setPointerCapture(event.pointerId);
    update(fromPointer(event));
  });
  divider.addEventListener('pointermove', (event) => {
    if (event.pointerId === pointerId) update(fromPointer(event));
  });
  function finish(event) {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    storeLayout();
  }
  divider.addEventListener('pointerup', finish);
  divider.addEventListener('pointercancel', finish);
  divider.addEventListener('keydown', (event) => {
    const backward = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    const forward = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    if (![backward, forward, 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    update(event.key === 'Home' ? 20 : event.key === 'End' ? 80 :
      layout[key] + (event.key === forward ? 2.5 : -2.5), true);
  });
  update(layout[key]);
  grid.append(divider);
}
function render() {
  for (const cell of cells) {
    stopCell(cell);
    cell.chart.destroy();
  }
  cells = [];
  grid.replaceChildren();
  grid.dataset.count = String(layout.mode);
  applySplitterStyles();
  for (let i = 0; i < layout.mode; i++) cells.push(newCell(i));
  if (layout.mode >= 2) addDivider('x');
  if (layout.mode === 4) addDivider('y');
  status();
}
function applyLayout(next) {
  layout = normalizeGridLayout(next);
  byId('grid-mode').value = String(layout.mode);
  byId('grid-sync-crosshair').checked = layout.syncCrosshair;
  byId('grid-sync-range').checked = layout.syncRange;
  byId('grid-demo').checked = layout.demo;
  storeLayout();
  render();
}
byId('grid-mode').addEventListener('change', () => {
  const next = Number(byId('grid-mode').value);
  if (!GRID_MODES.includes(next)) return;
  layout.mode = next;
  storeLayout();
  render();
});
byId('grid-sync-crosshair').addEventListener('change', () => {
  layout.syncCrosshair = byId('grid-sync-crosshair').checked;
  storeLayout();
  if (!layout.syncCrosshair) for (const c of cells) c.chart.setSyncedTime(null);
});
byId('grid-sync-range').addEventListener('change', () => {
  layout.syncRange = byId('grid-sync-range').checked;
  storeLayout();
});
byId('grid-demo').addEventListener('change', () => {
  layout.demo = byId('grid-demo').checked;
  storeLayout();
  render();
});
byId('grid-theme').addEventListener('change', () => {
  theme = normalTheme(byId('grid-theme').value);
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('bitcornwisdom:grid:theme', theme); } catch {}
  for (const cell of cells) cell.chart.setOptions({ theme });
});
function showLayoutNote(message, error = false) {
  const note = byId('grid-layout-note');
  note.textContent = message;
  note.style.color = error ? 'var(--down)' : '';
}
function refreshPresets(selected = '') {
  const select = byId('grid-presets');
  select.replaceChildren(new Option('Select saved…', ''));
  for (const item of presets) select.append(new Option(item.name, item.name));
  select.value = selected;
}
byId('grid-presets').addEventListener('change', () => {
  byId('grid-preset-name').value = byId('grid-presets').value;
});
byId('grid-save-preset').addEventListener('click', () => {
  const name = normalizeGridPresetName(byId('grid-preset-name').value);
  if (!name) return showLayoutNote('Enter a layout name', true);
  const index = presets.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
  if (index < 0 && presets.length >= GRID_PRESET_LIMIT)
    return showLayoutNote('Maximum ' + GRID_PRESET_LIMIT + ' saved layouts', true);
  const next = presets.slice();
  const item = { name, layout: normalizeGridLayout(layout) };
  if (index >= 0) next[index] = item;
  else next.push(item);
  try { presets = saveGridPresets(localStorage, next); }
  catch (error) { return showLayoutNote('Unable to save layout: ' + error.message, true); }
  refreshPresets(name);
  showLayoutNote('Saved: ' + name);
});
byId('grid-load-preset').addEventListener('click', () => {
  const name = byId('grid-presets').value;
  const item = presets.find((p) => p.name === name);
  if (!item) return showLayoutNote('Select a saved layout', true);
  applyLayout(item.layout);
  showLayoutNote('Loaded: ' + name);
});
byId('grid-delete-preset').addEventListener('click', () => {
  const name = byId('grid-presets').value;
  if (!name) return showLayoutNote('Select a saved layout', true);
  if (!confirm('Delete saved layout "' + name + '"?')) return;
  try { presets = saveGridPresets(localStorage, presets.filter((p) => p.name !== name)); }
  catch (error) { return showLayoutNote('Unable to delete layout: ' + error.message, true); }
  refreshPresets();
  byId('grid-preset-name').value = '';
  showLayoutNote('Deleted: ' + name);
});
byId('grid-export').addEventListener('click', () => {
  const json = exportGridWorkspace(layout, presets, theme);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'bitcornwisdom-workspace.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showLayoutNote('Exported active layout + ' + presets.length + ' presets');
});
byId('grid-import').addEventListener('click', () => byId('grid-import-file').click());
byId('grid-import-file').addEventListener('change', async () => {
  const input = byId('grid-import-file'), file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > GRID_WORKSPACE_MAX_BYTES) throw new Error('File exceeds 256 KiB');
    const imported = parseGridWorkspace(await file.text());
    // Parse and validate the whole document before changing active state.
    presets = saveGridPresets(localStorage, imported.presets);
    theme = normalTheme(imported.theme);
    try { localStorage.setItem('bitcornwisdom:grid:theme', theme); } catch {}
    document.documentElement.dataset.theme = theme;
    byId('grid-theme').value = theme;
    applyLayout(imported.active);
    refreshPresets();
    showLayoutNote('Imported active layout + ' + presets.length + ' presets');
  } catch (error) {
    showLayoutNote('Import rejected: ' + error.message, true);
  } finally {
    input.value = '';
  }
});
refreshPresets();
window.addEventListener('beforeunload', () => {
  for (const cell of cells) {
    stopCell(cell);
    cell.chart.destroy();
  }
});
render();
