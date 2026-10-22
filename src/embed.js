import { CandleChart } from './chart.js';
import { makeDemoCandles, nextDemoCandle } from './demo.js';
import { formatPrice } from './core.js';
import {
  INSTRUMENTS, EMBED_THEMES, feedPlan, normalizeEmbedConfig, resolveInstrument
} from './feed-policy.js';
import { FeedRouter } from './feed-router.js';
import { openFeedSource } from './feed-adapters.js';

const el = id => document.getElementById(id);
const chart = new CandleChart(el('embed-chart'));
const instruments = el('embed-instrument');
const intervals = el('embed-interval');
let epoch = 0, router = null, demoTimer = null, active = null;
let parentOrigin = null, lastCandleAt = null, currentSource = null;
let lastPublishedAt = 0;

function post(event, payload) {
  if (!parentOrigin || window.parent === window) return;
  window.parent.postMessage({ bitcorn: 'v1', type: 'event', event, payload }, parentOrigin);
}

function publicState() {
  return {
    version: '0.11', instrument: active?.instrument || null,
    interval: active?.interval || null, theme: active?.theme || 'noir',
    demo: Boolean(active?.demo), source: currentSource,
    price: chart.candles.at(-1)?.close ?? null, observedAt: lastCandleAt
  };
}

function setError(message) {
  el('embed-error').textContent = message;
  el('embed-error').hidden = false;
  el('embed-connection').textContent = 'ERROR';
  el('embed-connection').dataset.state = 'unavailable';
  post('error', { message });
}

function setStatus(state, reason, source) {
  el('embed-connection').dataset.state = state;
  el('embed-connection').textContent =
    state === 'live' ? '● LIVE' : state === 'demo' ? '● SYNTHETIC DEMO' :
      state === 'stale' ? 'STALE FEED' : state === 'unavailable' ? 'FEED UNAVAILABLE' :
      state === 'disrupted' ? 'RECONNECTING' : state === 'stopped' ? 'STOPPED' :
      'CONNECTING';
  el('embed-reason').textContent = reason === 'initial' ? 'Primary source · UTC' :
    reason === 'missing-live-candles' ? 'Failover · feed went stale' :
    reason === 'source-error' ? 'Failover · source unavailable' :
    reason === 'socket-disconnected' ? 'Failover · disconnected' :
    reason === 'demo' ? 'Synthetic offline prices' :
    (reason || 'Source health monitored');
  if (source) {
    currentSource = source;
    el('embed-source').textContent = source.kind === 'relay' ?
      'RELAY ' + source.sourceId.replace('relay:', '') : source.venue.toUpperCase();
    el('embed-source').dataset.source = source.sourceId;
  } else if (state !== 'demo') {
    currentSource = null;
    el('embed-source').textContent = 'NO SOURCE';
    delete el('embed-source').dataset.source;
  }
  post('status', { state, reason, source: currentSource });
}

function setPrice(candle) {
  lastCandleAt = Date.now();
  el('embed-price').textContent = formatPrice(candle.close);
  el('embed-age').textContent = 'LIVE TICK';
}

function updateIntervals(config) {
  const definition = resolveInstrument(config.instrument);
  intervals.replaceChildren();
  for (const interval of definition.intervals) intervals.append(new Option(interval, interval));
  intervals.value = config.interval;
  instruments.value = config.instrument;
}

function stopCurrent() {
  ++epoch;
  router?.stop();
  router = null;
  if (demoTimer !== null) clearInterval(demoTimer);
  demoTimer = null;
  lastCandleAt = null;
  lastPublishedAt = 0;
  currentSource = null;
  chart.setCandles([], active?.interval || '1m');
  el('embed-price').textContent = '—';
  el('embed-age').textContent = 'WAITING';
  el('embed-error').hidden = true;
}

function startConfig(next) {
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const plan = feedPlan({ ...next, allowLocal: isLocal });
  // Validate all source choices before closing a running valid feed.
  stopCurrent();
  active = { ...next };
  parentOrigin = next.parentOrigin || parentOrigin;
  document.documentElement.dataset.theme = active.theme;
  chart.setOptions({ theme: active.theme, depthProfileEnabled: false });
  updateIntervals(active);
  const session = epoch;
  if (active.demo) {
    const rows = makeDemoCandles(active.interval, 900);
    chart.setCandles(rows, active.interval);
    const synthetic = { sourceId: 'synthetic', venue: 'demo', kind: 'demo',
      symbol: active.instrument, instrument: active.instrument };
    currentSource = synthetic;
    el('embed-source').textContent = 'SYNTHETIC DEMO';
    el('embed-source').dataset.source = 'synthetic';
    setStatus('demo', 'demo', synthetic);
    setPrice(rows.at(-1));
    let tick = 0;
    demoTimer = setInterval(() => {
      if (session !== epoch) return;
      const last = chart.candles.at(-1);
      if (!last) return;
      const row = nextDemoCandle(last, active.interval, tick++);
      chart.updateCandle(row);
      setPrice(row);
      publishCandle(row);
    }, 1100);
    post('source', { source: synthetic, reason: 'demo' });
    return;
  }
  setStatus('connecting', 'initial', null);
  router = new FeedRouter({
    sources: plan,
    openSource: (source, callbacks, signal) => openFeedSource(source, callbacks, signal),
    onSource: snapshot => {
      if (epoch !== session) return;
      currentSource = snapshot.source;
      // Never display prior venue candles under the new venue's identity.
      chart.setCandles([], active.interval);
      lastCandleAt = null;
      el('embed-price').textContent = '—';
      if (snapshot.source) post('source', {
        source: snapshot.source, reason: snapshot.reason
      });
    },
    onStatus: snapshot => {
      if (epoch !== session) return;
      setStatus(snapshot.state, snapshot.reason, snapshot.source);
    },
    onHistory: candles => {
      if (epoch !== session) return;
      chart.setCandles(candles, active.interval);
      setPrice(candles.at(-1));
      el('embed-error').hidden = true;
    },
    onCandle: row => {
      if (epoch !== session) return;
      chart.updateCandle(row);
      setPrice(row);
      publishCandle(row);
    },
    onError: error => {
      if (epoch !== session) return;
      console.warn('Bitcorn feed:', error?.message || error);
    }
  });
  void router.start().then(ok => {
    if (epoch !== session) return;
    if (!ok && router?.snapshot().state === 'unavailable') {
      setError('No compatible source is reachable. Try another market or use offline demo.');
    }
  }).catch(error => {
    if (epoch === session) setError(String(error?.message || error));
  });
}

function publishCandle(row) {
  const now = performance.now();
  if (now - lastPublishedAt < 250) return;
  lastPublishedAt = now;
  post('candle', { candle: row, source: currentSource,
    instrument: active.instrument, interval: active.interval, receivedAt: Date.now() });
}

function applySelection(update) {
  const nextInstrument = update.instrument ?? active?.instrument ?? 'BTC-USD-SPOT';
  const changed = nextInstrument !== active?.instrument;
  const next = {
    ...active, instrument: nextInstrument,
    interval: update.interval ?? (changed ? '1m' : active?.interval ?? '1m'),
    preferred: Object.hasOwn(update, 'preferred') ? update.preferred :
      (changed ? null : active?.preferred ?? null),
    relays: update.relays ?? active?.relays ?? [],
    theme: active?.theme || 'noir',
    demo: update.demo ?? active?.demo ?? false
  };
  startConfig(next);
}

function handleCommand(message) {
  if (!message || message.bitcorn !== 'v1' || message.type !== 'command') return;
  const payload = message.payload;
  try {
    if (message.action === 'setSelection') {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        throw new TypeError('Expected selection object');
      applySelection(payload);
    } else if (message.action === 'setTheme') {
      if (!EMBED_THEMES.includes(payload?.theme)) throw new RangeError('Invalid theme');
      active.theme = payload.theme;
      document.documentElement.dataset.theme = active.theme;
      chart.setOptions({ theme: active.theme });
    } else if (message.action !== 'requestState') {
      throw new RangeError('Unknown embed command');
    }
    post('state', publicState());
  } catch (error) {
    post('error', { message: String(error.message || error) });
  }
}

window.addEventListener('message', event => {
  if (!parentOrigin || event.source !== window.parent || event.origin !== parentOrigin) return;
  handleCommand(event.data);
});

instruments.addEventListener('change', () => {
  try { applySelection({ instrument: instruments.value }); }
  catch (error) { setError(error.message); }
});
intervals.addEventListener('change', () => {
  try { applySelection({ interval: intervals.value }); }
  catch (error) { setError(error.message); }
});
const ageTimer = setInterval(() => {
  if (!lastCandleAt) return;
  const seconds = Math.max(0, Math.floor((Date.now() - lastCandleAt) / 1000));
  el('embed-age').textContent = seconds === 0 ? 'LIVE TICK' : seconds + 's AGO';
}, 1000);
window.addEventListener('pagehide', () => {
  stopCurrent();
  clearInterval(ageTimer);
  chart.destroy();
});

try {
  const input = normalizeEmbedConfig(new URLSearchParams(location.search));
  parentOrigin = input.parentOrigin;
  startConfig(input);
  post('ready', publicState());
} catch (error) {
  setError(String(error.message || error));
}
