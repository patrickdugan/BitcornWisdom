import { CandleChart } from './chart.js';
import { BinanceStream, checkMarket, fetchCandles } from './binance.js';
import { KrakenStream, KRAKEN_INTERVALS, krakenSymbols,
  fetchKrakenCandles, parseKrakenCandle } from './kraken.js';
import { CoinbaseStream, COINBASE_INTERVALS, coinbaseProduct,
  parseCoinbaseTrade, CoinbaseCandleBuilder, fetchCoinbaseCandles } from './coinbase.js';
import { ReconnectingSocket } from './realtime.js';
import { makeDemoCandles, nextDemoCandle } from './demo.js';
import { formatPrice } from './core.js';
import {
  GRID_LAYOUTS, normalizeGridLayout, normalizeGridPanes, normalizePane
} from './chart-grid-core.js';

const $ = (root, name) => root.querySelector('[data-role="' + name + '"]');
const venues = [
  ['spot', 'Binance Spot'], ['futures', 'Binance Futures'],
  ['kraken', 'Kraken'], ['coinbase', 'Coinbase']
];
const intervalNames = [
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h',
  '6h', '12h', '1d', '3d', '1w'
];
const drawingPrefix = 'bitcornwisdom:drawings:v1:';
const marketKey = (config) => drawingPrefix +
  [config.market, config.symbol, config.interval].join(':');

function readDrawings(config) {
  try { return JSON.parse(localStorage.getItem(marketKey(config)) || '[]'); }
  catch { return []; }
}
function saveDrawings(config, drawings) {
  try { localStorage.setItem(marketKey(config), JSON.stringify(drawings)); }
  catch { /* private browsing or quota denial */ }
}
function validate(config) {
  if (config.market === 'kraken') {
    krakenSymbols(config.symbol);
    if (!Object.hasOwn(KRAKEN_INTERVALS, config.interval)) throw new RangeError('Invalid Kraken interval');
  } else if (config.market === 'coinbase') {
    coinbaseProduct(config.symbol);
    if (!Object.hasOwn(COINBASE_INTERVALS, config.interval)) throw new RangeError('Invalid Coinbase interval');
  } else checkMarket(config.market, config.symbol, config.interval);
}
function fetchHistory(config, signal, endBefore = null) {
  if (config.market === 'kraken') return fetchKrakenCandles(config.symbol, config.interval, signal);
  if (config.market === 'coinbase')
    return fetchCoinbaseCandles(config.symbol, config.interval, signal, fetch, endBefore);
  return fetchCandles(config.market, config.symbol, config.interval, signal, 1000, fetch, endBefore);
}

/** Lean candle-only Kraken WS, avoiding repeated L2 subscriptions per grid tile. */
class KrakenCandleFeed {
  constructor(config, callbacks) {
    const symbol = krakenSymbols(config.symbol).wire;
    this.transport = new ReconnectingSocket('wss://ws.kraken.com/v2', {
      onStatus: callbacks.onStatus,
      onError: callbacks.onError,
      onOpen: (socket) => socket.send(JSON.stringify({
        method: 'subscribe',
        params: { channel: 'ohlc', symbol: [symbol],
          interval: KRAKEN_INTERVALS[config.interval], snapshot: true }
      })),
      onMessage: (message) => {
        const data = JSON.parse(message);
        if (data.method === 'subscribe' && data.success === false)
          throw new Error('Kraken OHLC subscription rejected: ' + data.error);
        if (data.channel !== 'ohlc' || !Array.isArray(data.data)) return;
        for (const candle of data.data) {
          if (candle.symbol === symbol) callbacks.onCandle(parseKrakenCandle(candle));
        }
      }
    });
  }
  start() { this.transport.start(); return this; }
  close() { this.transport.close(); }
}

/** Lean Coinbase trade-driven OHLCV; heartbeat gaps refresh public REST history. */
class CoinbaseCandleFeed {
  constructor(config, callbacks) {
    const product = coinbaseProduct(config.symbol);
    this.builder = new CoinbaseCandleBuilder(config.interval);
    this.seenConnection = false;
    this.transport = new ReconnectingSocket('wss://ws-feed.exchange.coinbase.com', {
      onStatus: callbacks.onStatus,
      onError: callbacks.onError,
      onOpen: (socket) => {
        if (this.seenConnection) callbacks.onReconnect?.();
        this.seenConnection = true;
        socket.send(JSON.stringify({
          type: 'subscribe',
          product_ids: [product],
          channels: ['matches', 'heartbeat']
        }));
      },
      onMessage: (raw) => {
        const m = JSON.parse(raw);
        if (m.type === 'error') throw new Error(m.message || 'Coinbase subscription rejected');
        if (m.product_id !== product) return;
        if (m.type === 'last_match') {
          const id = Number(m.trade_id);
          if (Number.isSafeInteger(id)) this.builder.lastTradeId = Math.max(this.builder.lastTradeId, id);
        } else if (m.type === 'match') {
          const result = this.builder.ingest(parseCoinbaseTrade(m));
          if (result) callbacks.onCandle(result);
        } else if (m.type === 'heartbeat') {
          // This lightweight pane cannot replay missing matches; refresh OHLCV from REST.
          const latest = Number(m.last_trade_id);
          if (Number.isSafeInteger(latest) && this.builder.lastTradeId >= 0 &&
              latest > this.builder.lastTradeId + 1) callbacks.onGap?.();
        }
      }
    });
  }
  seed(data) { this.builder.seed(data.at(-1)); }
  start() { this.transport.start(); return this; }
  close() { this.transport.close(); }
}

function paneHTML(number) {
  const venueOptions = venues.map(([value, name]) =>
    '<option value="' + value + '">' + name + '</option>').join('');
  const timeOptions = intervalNames.map((value) =>
    '<option value="' + value + '">' + value + '</option>').join('');
  return '<div class="grid-pane-top">' +
    '<span class="grid-pane-index">' + String(number).padStart(2, '0') + ' / CHART</span>' +
    '<form class="grid-pane-controls" data-role="form" autocomplete="off">' +
      '<select class="pane-market" data-role="market" aria-label="Chart ' + number + ' exchange">' + venueOptions + '</select>' +
      '<input class="pane-symbol" data-role="symbol" aria-label="Chart ' + number + ' symbol" maxlength="24" spellcheck="false">' +
      '<select class="pane-interval" data-role="interval" aria-label="Chart ' + number + ' timeframe">' + timeOptions + '</select>' +
      '<button class="pane-load" type="submit" title="Load this market">↗</button>' +
      '<button data-role="EMA" type="button" title="EMA 20" aria-pressed="false">EMA</button>' +
      '<button data-role="BB" type="button" title="Bollinger Bands" aria-pressed="false">BB</button>' +
      '<button data-role="RSI" type="button" title="RSI 14" aria-pressed="false">RSI</button>' +
      '<span class="grid-pane-status" data-role="status">WAIT</span>' +
    '</form></div>' +
    '<div class="chart-grid-viewport" data-role="viewport">' +
    '<canvas data-role="canvas" tabindex="0" aria-label="Secondary chart ' + number + '"></canvas>' +
    '<div class="grid-pane-error" data-role="error" hidden>' +
      '<span data-role="error-message"></span>' +
      '<button data-role="retry" type="button">Retry</button>' +
    '</div></div>';
}

function demoPriceScale(symbol) {
  if (symbol.startsWith('ETH')) return 0.053;
  if (symbol.startsWith('SOL')) return .0032;
  if (symbol.startsWith('XRP')) return .000031;
  return 1;
}
function scaleDemo(candles, config) {
  const scalar = demoPriceScale(config.symbol);
  return candles.map((v) => ({
    ...v, open: v.open * scalar, high: v.high * scalar,
    low: v.low * scalar, close: v.close * scalar
  }));
}

class SecondaryPane {
  constructor(host, index, grid) {
    this.grid = grid;
    this.index = index;
    this.host = host;
    this.host.className = 'chart-grid-pane secondary-pane';
    this.host.dataset.pane = String(index + 2);
    this.host.innerHTML = paneHTML(index + 2);
    this.pref = grid.settings.gridPanes[index];
    this.serial = 0;
    this.stream = null;
    this.fetchController = null;
    this.pageController = null;
    this.refreshController = null;
    this.demoTimer = null;
    this.lastGapRefresh = 0;
    this.ui = {
      market: $(host, 'market'), symbol: $(host, 'symbol'),
      interval: $(host, 'interval'), status: $(host, 'status'),
      canvas: $(host, 'canvas'), error: $(host, 'error')
    };
    this.chart = new CandleChart(this.ui.canvas, {
      onDrawingsChange: (drawings) => saveDrawings(this.pref, drawings),
      onCursor: (source, time) => grid.broadcastCursor(source, time),
      onViewportChange: (source, state) => grid.broadcastViewport(source, state)
    });
    this.chart.setOptions({
      showEMA: this.pref.showEMA, showSMA: this.pref.showSMA,
      showBB: this.pref.showBB, showRSI: this.pref.showRSI,
      logarithmic: this.pref.logarithmic, theme: grid.settings.theme
    });

    $(host, 'form').addEventListener('submit', (event) => {
      event.preventDefault();
      const newPref = {
        ...this.pref, market: this.ui.market.value,
        symbol: this.ui.symbol.value.trim().toUpperCase(),
        interval: this.ui.interval.value
      };
      try { validate(newPref); }
      catch (error) { this.status('error', error.message); return; }
      this.setPreference(newPref, true);
    });
    this.ui.market.addEventListener('change', () => {
      const prior = this.pref.market, next = this.ui.market.value;
      let symbol = this.ui.symbol.value.trim().toUpperCase();
      if (['coinbase','kraken'].includes(next) && !['coinbase','kraken'].includes(prior) && symbol === 'BTCUSDT')
        symbol = 'BTCUSD';
      if (['spot','futures'].includes(next) && ['coinbase','kraken'].includes(prior) && symbol === 'BTCUSD')
        symbol = 'BTCUSDT';
      const pref = normalizePane({ ...this.pref, market: next, symbol }, this.index);
      this.setPreference(pref, true);
    });
    this.ui.interval.addEventListener('change', () => {
      this.setPreference(normalizePane({ ...this.pref, interval: this.ui.interval.value }, this.index), true);
    });
    for (const [key, property] of [
      ['EMA', 'showEMA'], ['BB', 'showBB'], ['RSI', 'showRSI']
    ]) {
      $(host, key).addEventListener('click', () => {
        this.pref = { ...this.pref, [property]: !this.pref[property] };
        grid.savePreference(index, this.pref);
        this.chart.setOptions({ [property]: this.pref[property] });
        this.paintControls();
      });
    }
    $(host, 'retry').addEventListener('click', () => this.load());
    this.paintControls();
    this.load();
  }

  paintControls() {
    const p = this.pref;
    this.ui.market.value = p.market;
    this.ui.symbol.value = p.symbol;
    for (const option of this.ui.interval.options) {
      option.disabled = (p.market === 'kraken' && !Object.hasOwn(KRAKEN_INTERVALS, option.value)) ||
        (p.market === 'coinbase' && !Object.hasOwn(COINBASE_INTERVALS, option.value));
    }
    this.ui.interval.value = p.interval;
    for (const [name, field] of [['EMA','showEMA'],['BB','showBB'],['RSI','showRSI']]) {
      const button = $(this.host, name);
      button.classList.toggle('active', p[field]);
      button.setAttribute('aria-pressed', String(p[field]));
    }
    this.ui.canvas.dataset.market = p.market;
    this.ui.canvas.dataset.symbol = p.symbol;
    this.ui.canvas.dataset.interval = p.interval;
  }

  setPreference(next, reload = true) {
    validate(next);
    this.pref = normalizePane(next, this.index);
    this.grid.savePreference(this.index, this.pref);
    this.paintControls();
    if (reload) this.load();
  }

  status(status, reason = '') {
    this.ui.status.dataset.state = status;
    this.ui.status.textContent = status === 'live' ? 'LIVE' :
      status === 'demo' ? 'DEMO' :
      status === 'loading' ? 'LOADING' :
      status === 'error' ? 'ERROR' :
      status === 'reconnecting' ? 'RETRY' : 'SYNC';
    this.ui.status.title = reason || status;
    this.ui.canvas.dataset.feedStatus = status;
    if (status !== 'error') this.ui.error.hidden = true;
    else {
      $(this.host, 'error-message').textContent = reason;
      this.ui.error.hidden = false;
    }
  }

  stop() {
    this.serial += 1;
    if (this.fetchController) this.fetchController.abort();
    if (this.pageController) this.pageController.abort();
    if (this.refreshController) this.refreshController.abort();
    this.fetchController = this.pageController = this.refreshController = null;
    if (this.stream) this.stream.close();
    this.stream = null;
    if (this.demoTimer !== null) clearInterval(this.demoTimer);
    this.demoTimer = null;
    this.chart.onHistoryNeeded = null;
    this.chart.setLinkedCursorTime(null);
  }

  async loadOlder(serial, config) {
    if (this.serial !== serial || !this.chart.candles.length || this.pageController) return null;
    const controller = new AbortController();
    this.pageController = controller;
    try {
      const history = await fetchHistory(config, controller.signal, this.chart.candles[0].time);
      if (this.serial !== serial || controller.signal.aborted) return null;
      const count = this.chart.prependHistory(history);
      if (count) this.ui.canvas.dataset.candles = String(this.chart.candles.length);
      return count > 0;
    } catch (error) {
      if (!controller.signal.aborted) console.warn('Secondary historical page failed:', error);
      return null;
    } finally {
      if (this.pageController === controller) this.pageController = null;
    }
  }

  async refreshCoinbase(serial, config) {
    if (this.serial !== serial || this.refreshController) return;
    const controller = new AbortController();
    this.refreshController = controller;
    try {
      const data = await fetchCoinbaseCandles(config.symbol, config.interval, controller.signal);
      if (this.serial !== serial || controller.signal.aborted || !data.length) return;
      this.chart.replaceRecentHistory(data);
      this.stream?.seed?.(data);
      this.ui.canvas.dataset.candles = String(this.chart.candles.length);
    } catch (error) {
      if (!controller.signal.aborted) console.warn('Secondary Coinbase OHLC refresh failed:', error);
    } finally {
      if (this.refreshController === controller) this.refreshController = null;
    }
  }

  async load() {
    this.stop();
    const serial = this.serial;
    const config = { ...this.pref };
    this.chart.setCandles([], config.interval);
    this.chart.setDrawings(readDrawings(config));
    this.paintControls();
    this.status('loading');
    if (this.grid.settings.demo) {
      const candles = scaleDemo(makeDemoCandles(config.interval, 900), config);
      if (this.serial !== serial) return;
      this.chart.setCandles(candles, config.interval);
      this.ui.canvas.dataset.candles = String(this.chart.candles.length);
      this.status('demo');
      this.grid.syncChartToPrimary(this.chart);
      let tick = 0;
      this.demoTimer = setInterval(() => {
        if (this.serial !== serial || !this.chart.candles.length) return;
        this.chart.updateCandle(nextDemoCandle(this.chart.candles.at(-1), config.interval, tick++));
        this.ui.canvas.dataset.candles = String(this.chart.candles.length);
      }, 1200);
      return;
    }

    const controller = new AbortController();
    this.fetchController = controller;
    try {
      const data = await fetchHistory(config, controller.signal);
      if (this.serial !== serial || controller.signal.aborted) return;
      if (!data.length) throw new Error('No public candle history returned');
      this.chart.setCandles(data, config.interval);
      this.ui.canvas.dataset.candles = String(data.length);
      this.chart.onHistoryNeeded = config.market === 'kraken' ? null :
        () => this.loadOlder(serial, config);
      this.grid.syncChartToPrimary(this.chart);
      const callbacks = {
        onStatus: (status) => { if (this.serial === serial) this.status(status); },
        onError: (error) => {
          if (this.serial === serial) console.warn('Secondary feed:', config.symbol, error);
        },
        onCandle: (candle) => {
          if (this.serial !== serial) return;
          this.chart.updateCandle(candle);
          this.ui.canvas.dataset.candles = String(this.chart.candles.length);
          this.ui.canvas.dataset.lastPrice = formatPrice(candle.close);
        },
        onReconnect: () => this.refreshCoinbase(serial, config),
        onGap: () => {
          if (Date.now() - this.lastGapRefresh > 30_000) {
            this.lastGapRefresh = Date.now();
            this.refreshCoinbase(serial, config);
          }
        }
      };
      if (config.market === 'kraken') {
        this.stream = new KrakenCandleFeed(config, callbacks).start();
      } else if (config.market === 'coinbase') {
        this.stream = new CoinbaseCandleFeed(config, callbacks);
        this.stream.seed(data);
        this.stream.start();
      } else {
        this.stream = new BinanceStream(config.market, config.symbol, config.interval, callbacks).start();
      }
    } catch (error) {
      if (this.serial === serial && !controller.signal.aborted) this.status('error', error.message);
    } finally {
      if (this.fetchController === controller) this.fetchController = null;
    }
  }

  destroy() {
    this.stop();
    this.chart.destroy();
    this.host.remove();
  }
}

export class ChartGrid {
  constructor({ root, primary, settings, persist }) {
    this.root = root;
    this.primary = primary;
    this.settings = settings;
    this.persist = persist;
    this.panes = [];
    this.primaryPane = document.getElementById('grid-primary-pane');
    this.settings.chartLayout = normalizeGridLayout(settings.chartLayout);
    this.settings.gridPanes = normalizeGridPanes(settings.gridPanes);
    this.settings.gridLinkTime = settings.gridLinkTime === true;
    this.settings.gridLinkCursor = settings.gridLinkCursor !== false;
    document.getElementById('grid-layout').addEventListener('change', (event) =>
      this.setLayout(event.target.value));
    document.getElementById('grid-link-time').addEventListener('change', (event) => {
      this.settings.gridLinkTime = event.target.checked;
      this.persist();
      if (this.settings.gridLinkTime) this.syncFromPrimary();
    });
    document.getElementById('grid-link-cursor').addEventListener('change', (event) => {
      this.settings.gridLinkCursor = event.target.checked;
      this.persist();
      if (!event.target.checked) this.clearLinkedCursors();
    });
    this.setLayout(this.settings.chartLayout);
  }

  get charts() { return [this.primary, ...this.panes.map((pane) => pane.chart)]; }

  savePreference(index, pane) {
    this.settings.gridPanes[index] = normalizePane(pane, index);
    this.persist();
  }

  setLayout(next) {
    const count = normalizeGridLayout(next);
    this.settings.chartLayout = count;
    this.root.classList.remove('layout-1', 'layout-2', 'layout-4');
    this.root.classList.add('layout-' + count);
    document.getElementById('grid-layout').value = String(count);
    document.getElementById('grid-link-time').checked = this.settings.gridLinkTime;
    document.getElementById('grid-link-cursor').checked = this.settings.gridLinkCursor;
    while (this.panes.length > count - 1) this.panes.pop().destroy();
    while (this.panes.length < count - 1) {
      const index = this.panes.length;
      const host = document.createElement('section');
      this.root.append(host);
      const pane = new SecondaryPane(host, index, this);
      this.panes.push(pane);
    }
    this.primary.resize();
    for (const pane of this.panes) pane.chart.resize();
    this.updatePrimaryLabel();
    this.persist();
  }

  updatePrimaryLabel() {
    document.getElementById('grid-primary-label').textContent =
      this.settings.symbol + ' · ' + this.settings.interval;
    this.primaryPane.dataset.market = this.settings.market;
    this.primaryPane.dataset.symbol = this.settings.symbol;
  }

  setTheme(theme) {
    for (const pane of this.panes) pane.chart.setOptions({ theme });
  }

  clearLinkedCursors() {
    for (const chart of this.charts) chart.setLinkedCursorTime(null);
  }

  broadcastCursor(source, time) {
    if (!this.settings.gridLinkCursor || this.settings.chartLayout === 1) return;
    for (const chart of this.charts) if (chart !== source) chart.setLinkedCursorTime(time);
  }

  broadcastViewport(source, info) {
    if (!this.settings.gridLinkTime || this.settings.chartLayout === 1) return;
    for (const chart of this.charts) if (chart !== source) chart.setLinkedViewport(info);
  }

  syncChartToPrimary(other) {
    if (this.settings.gridLinkTime && this.primary.candles.length) {
      const info = this.primary.getViewportDescriptor();
      if (info) other.setLinkedViewport(info);
    }
  }

  syncFromPrimary() {
    if (!this.settings.gridLinkTime || !this.primary.candles.length) return;
    const info = this.primary.getViewportDescriptor();
    if (!info) return;
    for (const pane of this.panes) pane.chart.setLinkedViewport(info);
  }

  reloadSecondary() { for (const pane of this.panes) pane.load(); }
  destroy() { while (this.panes.length) this.panes.pop().destroy(); }
}

export function mountChartGrid(options) { return new ChartGrid(options); }
