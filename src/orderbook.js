// Binance Level-2 reconstruction from REST snapshots and sequenced diff-depth events.
// No timers or IO: this state machine is deterministic and exhaustively unit-testable.
const numeric = (v, name) => {
  const x = Number(v);
  if (!Number.isFinite(x)) throw new TypeError('Invalid ' + name);
  return x;
};

export function parseDepthDelta(message) {
  if (!message || message.e !== 'depthUpdate') throw new TypeError('Expected depthUpdate');
  const U = numeric(message.U, 'first update id');
  const u = numeric(message.u, 'final update id');
  if (!Number.isSafeInteger(U) || !Number.isSafeInteger(u) || U < 0 || u < U) {
    throw new TypeError('Invalid depth update sequence');
  }
  const levels = (rows) => {
    if (!Array.isArray(rows)) throw new TypeError('Missing depth rows');
    return rows.map((row) => {
      if (!Array.isArray(row) || row.length < 2) throw new TypeError('Invalid depth row');
      const price = numeric(row[0], 'price'), size = numeric(row[1], 'quantity');
      if (price <= 0 || size < 0) throw new TypeError('Invalid depth level');
      return [price, size];
    });
  };
  return {
    U, u, pu: message.pu == null ? null : numeric(message.pu, 'previous id'),
    time: Number.isFinite(Number(message.E)) ? Number(message.E) : Date.now(),
    bids: levels(message.b), asks: levels(message.a)
  };
}

export function parseDepthSnapshot(body) {
  const lastUpdateId = numeric(body?.lastUpdateId, 'snapshot update id');
  if (!Number.isSafeInteger(lastUpdateId) || lastUpdateId < 0 ||
      !Array.isArray(body.bids) || !Array.isArray(body.asks)) {
    throw new TypeError('Invalid REST depth snapshot');
  }
  const parseRows = (rows) => new Map(rows.map(([p, q]) => {
    const price = numeric(p, 'price'), size = numeric(q, 'quantity');
    if (price <= 0 || size < 0) throw new TypeError('Invalid book level');
    return [price, size];
  }).filter(([, size]) => size > 0));
  return { lastUpdateId, bids: parseRows(body.bids), asks: parseRows(body.asks) };
}

export class SequencedOrderBook {
  constructor(market = 'spot', callbacks = {}, { maxBuffered = 4096, maxLevels = 1000 } = {}) {
    if (!['spot', 'futures'].includes(market)) throw new RangeError('Invalid market');
    this.market = market;
    this.callbacks = callbacks;
    this.maxBuffered = maxBuffered;
    this.maxLevels = maxLevels;
    this.reset('initial', false);
  }

  reset(reason = 'disconnected', notify = true) {
    this.bids = new Map();
    this.asks = new Map();
    this.lastUpdateId = null;
    this.phase = 'buffering';
    this.buffer = [];
    this.callbacks.onStatus?.('syncing', reason);
    if (notify) this.callbacks.onResync?.(reason);
  }

  ingest(raw) {
    const event = parseDepthDelta(raw);
    if (this.phase === 'buffering') {
      this.buffer.push(event);
      if (this.buffer.length > this.maxBuffered) this.reset('depth buffer overflow');
      return 'buffered';
    }
    return this.apply(event);
  }

  installSnapshot(raw) {
    const snapshot = parseDepthSnapshot(raw);
    // A snapshot older than the first buffered delta cannot bridge the stream.
    if (this.buffer.length) {
      const first = this.buffer[0];
      if (snapshot.lastUpdateId + (this.market === 'spot' ? 1 : 0) < first.U) {
        return 'retry';
      }
    }
    this.bids = snapshot.bids;
    this.asks = snapshot.asks;
    this.lastUpdateId = snapshot.lastUpdateId;
    this.phase = 'bridging';
    const pending = this.buffer;
    this.buffer = [];
    for (const event of pending) {
      if (this.phase === 'buffering') break; // A sequence gap already invalidated the snapshot.
      this.apply(event);
    }
    return this.phase === 'buffering' ? 'resync' : this.phase;
  }

  apply(event) {
    if (event.u <= this.lastUpdateId) return 'stale';
    const anchor = this.lastUpdateId;
    if (this.phase === 'bridging') {
      // Futures explicitly requires the initial event to span the snapshot's ID.
      const upper = anchor + (this.market === 'spot' ? 1 : 0);
      if (event.U > upper || event.u < anchor) {
        this.reset('snapshot-to-stream gap');
        return 'resync';
      }
    } else if (this.phase === 'live') {
      if (event.U > anchor + 1 ||
        (this.market === 'futures' && event.pu !== anchor)) {
        this.reset('missing or out-of-order depth event');
        return 'resync';
      }
    } else {
      throw new Error('Cannot apply depth delta before a snapshot');
    }

    for (const [price, size] of event.bids) {
      if (size === 0) this.bids.delete(price);
      else this.bids.set(price, size);
    }
    for (const [price, size] of event.asks) {
      if (size === 0) this.asks.delete(price);
      else this.asks.set(price, size);
    }
    this.lastUpdateId = event.u;
    this.phase = 'live';
    this.trim();
    const book = this.snapshot(event.time);
    if (book.bids.length && book.asks.length && book.bids[0][0] >= book.asks[0][0]) {
      this.reset('crossed local book');
      return 'resync';
    }
    this.callbacks.onStatus?.('live');
    this.callbacks.onBook?.(book);
    return 'applied';
  }

  trim() {
    const threshold = this.maxLevels * 2;
    if (this.bids.size > threshold) {
      this.bids = new Map([...this.bids].sort((a, b) => b[0] - a[0]).slice(0, this.maxLevels));
    }
    if (this.asks.size > threshold) {
      this.asks = new Map([...this.asks].sort((a, b) => a[0] - b[0]).slice(0, this.maxLevels));
    }
  }

  snapshot(time = Date.now()) {
    return {
      time,
      lastUpdateId: this.lastUpdateId,
      source: 'sequenced-depth',
      bids: [...this.bids].sort((a, b) => b[0] - a[0]).slice(0, this.maxLevels),
      asks: [...this.asks].sort((a, b) => a[0] - b[0]).slice(0, this.maxLevels)
    };
  }
}
