// Framework-neutral v0.11 SDK. ES module, no bundler or dependencies.
// The host and the iframe communicate only with exact-origin postMessage.
const EVENT_NAMES = new Set(['ready', 'status', 'source', 'candle', 'state', 'error']);

export function embedUrl(options = {}, moduleUrl = import.meta.url,
  parentOrigin = typeof window !== 'undefined' ? window.location.origin : null) {
  const url = new URL(options.embedUrl || '../embed.html', moduleUrl);
  if (!['https:', 'http:'].includes(url.protocol))
    throw new RangeError('Embed must use an HTTP(S) page');
  if (parentOrigin && parentOrigin !== 'null')
    url.searchParams.set('parentOrigin', parentOrigin);
  for (const key of ['instrument', 'interval', 'preferred', 'theme']) {
    if (options[key] !== undefined && options[key] !== null)
      url.searchParams.set(key, String(options[key]));
  }
  if (options.demo !== undefined) url.searchParams.set('demo', options.demo ? '1' : '0');
  if (options.relays !== undefined) {
    if (!Array.isArray(options.relays) || options.relays.length > 2)
      throw new RangeError('At most two relay URLs are supported');
    url.searchParams.delete('relay');
    for (const relay of options.relays) url.searchParams.append('relay', relay);
  }
  return url;
}

export function mountBitcornChart(target, options = {}) {
  const host = typeof target === 'string' ? document.querySelector(target) : target;
  if (!host || typeof host.append !== 'function')
    throw new TypeError('Expected an existing chart container or CSS selector');
  const url = embedUrl(options);
  if (!window.location.origin || window.location.origin === 'null')
    throw new Error('Host page must use an HTTP(S) origin for secure SDK messages');
  const sourceOrigin = url.origin;
  const handlers = new Map();
  const queue = [];
  let destroyed = false, ready = false, lastState = null;
  let resolveReady, rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve; rejectReady = reject;
  });
  const iframe = document.createElement('iframe');
  iframe.title = options.title || 'BitcornWisdom live market chart';
  iframe.src = url.href;
  iframe.loading = 'eager';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  iframe.setAttribute('allow', 'fullscreen');
  iframe.style.display = 'block';
  iframe.style.width = '100%';
  iframe.style.height = options.height || '400px';
  iframe.style.border = '0';
  iframe.style.borderRadius = '6px';

  function emit(name, payload) {
    for (const fn of handlers.get(name) || []) {
      try { fn(payload); } catch (error) { console.error('Bitcorn handler:', error); }
    }
  }
  function post(action, payload = {}) {
    if (destroyed) throw new Error('Bitcorn chart has been destroyed');
    const command = { bitcorn: 'v1', type: 'command', action, payload };
    if (!ready) queue.push(command);
    else iframe.contentWindow?.postMessage(command, sourceOrigin);
  }
  function onMessage(event) {
    if (destroyed || event.source !== iframe.contentWindow || event.origin !== sourceOrigin)
      return;
    const message = event.data;
    if (!message || message.bitcorn !== 'v1' || message.type !== 'event' ||
      !EVENT_NAMES.has(message.event)) return;
    if (message.event === 'state' || message.event === 'ready') lastState = message.payload;
    if (message.event === 'ready' && !ready) {
      ready = true;
      clearTimeout(readyTimeout);
      resolveReady(api);
      for (const command of queue.splice(0)) iframe.contentWindow?.postMessage(command, sourceOrigin);
    }
    emit(message.event, message.payload);
  }
  const api = {
    iframe,
    ready: readyPromise,
    on(event, handler) {
      if (!EVENT_NAMES.has(event) || typeof handler !== 'function')
        throw new TypeError('Unknown event or handler');
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
      return () => handlers.get(event)?.delete(handler);
    },
    setSelection(selection) {
      if (!selection || typeof selection !== 'object' || Array.isArray(selection))
        throw new TypeError('Expected selection object');
      post('setSelection', selection);
    },
    setMarket(instrument, interval) {
      this.setSelection(interval === undefined ? { instrument } : { instrument, interval });
    },
    setTheme(theme) { post('setTheme', { theme }); },
    requestState() { post('requestState'); },
    getState() { return lastState ? { ...lastState } : null; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(readyTimeout);
      iframe.remove();
      handlers.clear();
      queue.length = 0;
      if (!ready) rejectReady(new Error('Bitcorn embed destroyed before ready'));
    }
  };
  const readyTimeout = setTimeout(() => {
    if (!ready && !destroyed) {
      rejectReady(new Error('Bitcorn embed did not complete handshake'));
      emit('error', { message: 'Embed handshake timed out' });
    }
  }, Number.isFinite(options.timeoutMs) ? Math.max(500, options.timeoutMs) : 15000);
  window.addEventListener('message', onMessage);
  host.append(iframe);
  return api;
}
