// Binance Level-2 reconstruction + OG bitcoinwisdom.com L2 level-clearing diff & decay tracker.
// No timers or IO: this state machine is deterministic and exhaustively unit-testable.
export const DEFAULT_CLEAR_TTL_MS = 420;
export const DEFAULT_SWEEP_RATIO = 0.25;

const numeric = (v, name) => {
  const x = Number(v);
  if (!Number.isFinite(x)) throw new TypeError('Invalid ' + name);
  return x;
};

function sideToPriceMap(sideRows) {
  const map = new Map();
  if (!sideRows) return map;
  if (sideRows instanceof Map) {
    for (const [p, q] of sideRows.entries()) {
      const price = Number(p), size = Number(q);
      if (Number.isFinite(price) && price > 0 && Number.isFinite(size) && size > 0) {
        map.set(price, (map.get(price) || 0) + size);
      }
    }
    return map;
  }
  if (!Array.isArray(sideRows)) return map;
  for (const row of sideRows) {
    if (Array.isArray(row) && row.length >= 2) {
      const price = Number(row[0]), size = Number(row[1]);
      if (Number.isFinite(price) && price > 0 && Number.isFinite(size) && size > 0) {
        map.set(price, (map.get(price) || 0) + size);
      }
    } else if (row && typeof row === 'object') {
      const price = Number(row.priceUsd ?? row.price);
      const size = Number(row.sizeUsd ?? row.valueBtc ?? row.qty ?? row.size);
      if (Number.isFinite(price) && price > 0 && Number.isFinite(size) && size > 0) {
        map.set(price, (map.get(price) || 0) + size);
      }
    }
  }
  return map;
}

/**
 * Diffs consecutive L2 orderbook snapshots (`bids` and `asks`) to detect:
 *  - `wiped`: level completely cleared (`prevSize > 0 -> 0`)
 *  - `swept`: liquidity consumed by `>= sweepRatio` (default 25%)
 *  - `addedWalls`: new or stacked resting walls (`prevSize === 0 -> > 0` or `>= +50%`)
 */
export function diffOrderBookLevels(prevBook, nextBook, {
  now = Date.now(),
  ttlMs = DEFAULT_CLEAR_TTL_MS,
  sweepRatio = DEFAULT_SWEEP_RATIO,
  maxEvents = 32
} = {}) {
  const safeTtl = Math.min(500, Math.max(350, Number.isFinite(ttlMs) ? ttlMs : DEFAULT_CLEAR_TTL_MS));
  const threshold = Number.isFinite(sweepRatio) && sweepRatio > 0 ? sweepRatio : DEFAULT_SWEEP_RATIO;
  if (!prevBook || !nextBook) {
    return { clearedLevels: [], addedWalls: [] };
  }

  const clearedLevels = [];
  const addedWalls = [];

  const compareSide = (prevSide, nextSide, side) => {
    const prevMap = sideToPriceMap(prevSide);
    const nextMap = sideToPriceMap(nextSide);
    if (!prevMap.size && !nextMap.size) return;

    // Guard against false sweeps when a truncated depth window merely shifts range:
    // keep prices within the observable window or explicit top-of-book sweeps.
    const nextPrices = [...nextMap.keys()];
    const minNext = nextPrices.length ? Math.min(...nextPrices) : -Infinity;
    const maxNext = nextPrices.length ? Math.max(...nextPrices) : Infinity;

    for (const [price, prevSize] of prevMap.entries()) {
      const nextSize = nextMap.get(price) ?? 0;
      if (nextSize === 0) {
        // For deep tail levels falling off the back of a bounded window, ignore;
        // if inside or at the aggressive inside edge of the book, it was genuinely wiped!
        const droppedOffTail = nextPrices.length >= 10 &&
          (side === 'bid' ? price < minNext : price > maxNext);
        if (droppedOffTail) continue;
        clearedLevels.push({
          side,
          price,
          prevSize,
          nextSize: 0,
          deltaSize: prevSize,
          clearedRatio: 1,
          kind: 'wiped',
          clearedAt: now,
          expiresAt: now + safeTtl,
          ttlMs: safeTtl
        });
      } else if (nextSize < prevSize) {
        const deltaSize = prevSize - nextSize;
        const clearedRatio = deltaSize / prevSize;
        if (clearedRatio + 1e-12 >= threshold) {
          clearedLevels.push({
            side,
            price,
            prevSize,
            nextSize,
            deltaSize,
            clearedRatio,
            kind: 'swept',
            clearedAt: now,
            expiresAt: now + safeTtl,
            ttlMs: safeTtl
          });
        }
      }
    }

    for (const [price, nextSize] of nextMap.entries()) {
      const prevSize = prevMap.get(price) ?? 0;
      if (prevSize === 0) {
        const enteredFromTail = nextPrices.length >= 10 &&
          (side === 'bid' ? price <= minNext : price >= maxNext);
        if (!enteredFromTail) {
          addedWalls.push({
            side,
            price,
            prevSize: 0,
            nextSize,
            deltaSize: nextSize,
            kind: 'appeared',
            at: now,
            expiresAt: now + safeTtl,
            ttlMs: safeTtl
          });
        }
      } else if (nextSize >= prevSize * 1.5) {
        addedWalls.push({
          side,
          price,
          prevSize,
          nextSize,
          deltaSize: nextSize - prevSize,
          kind: 'stacked',
          at: now,
          expiresAt: now + safeTtl,
          ttlMs: safeTtl
        });
      }
    }
  };

  compareSide(prevBook.bids, nextBook.bids, 'bid');
  compareSide(prevBook.asks, nextBook.asks, 'ask');

  clearedLevels.sort((a, b) => b.deltaSize - a.deltaSize || a.price - b.price);
  addedWalls.sort((a, b) => b.deltaSize - a.deltaSize || a.price - b.price);

  return {
    clearedLevels: clearedLevels.slice(0, maxEvents),
    addedWalls: addedWalls.slice(0, maxEvents)
  };
}

/**
 * Stateful deterministic L2 level-clearing & wall-appearance decay tracker (350ms-500ms TTL).
 */
export class OrderBookLevelTracker {
  constructor({
    ttlMs = DEFAULT_CLEAR_TTL_MS,
    sweepRatio = DEFAULT_SWEEP_RATIO,
    maxActive = 48
  } = {}) {
    this.ttlMs = Math.min(500, Math.max(350, Number.isFinite(ttlMs) ? ttlMs : DEFAULT_CLEAR_TTL_MS));
    this.sweepRatio = sweepRatio;
    this.maxActive = maxActive;
    this.reset();
  }

  reset() {
    this.previousBook = null;
    this.clearedByKey = new Map();
    this.wallsByKey = new Map();
  }

  prune(now = Date.now()) {
    for (const [key, entry] of this.clearedByKey.entries()) {
      if (!(entry.expiresAt > now)) this.clearedByKey.delete(key);
    }
    for (const [key, entry] of this.wallsByKey.entries()) {
      if (!(entry.expiresAt > now)) this.wallsByKey.delete(key);
    }
  }

  observe(book, now = Date.now()) {
    this.prune(now);
    if (!book || (!book.bids && !book.asks)) {
      return { clearedLevels: [], activeCleared: [], activeWalls: [] };
    }
    const normalized = {
      bids: [...sideToPriceMap(book.bids).entries()].sort((a, b) => b[0] - a[0]),
      asks: [...sideToPriceMap(book.asks).entries()].sort((a, b) => a[0] - b[0])
    };

    const diff = this.previousBook
      ? diffOrderBookLevels(this.previousBook, normalized, {
          now, ttlMs: this.ttlMs, sweepRatio: this.sweepRatio, maxEvents: this.maxActive
        })
      : { clearedLevels: [], addedWalls: [] };

    // Also incorporate explicit clearedLevels attached by upstream SequencedOrderBook if present
    const explicit = Array.isArray(book.clearedLevels) ? book.clearedLevels : [];
    const combinedCleared = [...diff.clearedLevels];
    for (const item of explicit) {
      if (!item || !Number.isFinite(item.price) || !(item.prevSize > 0)) continue;
      if (!combinedCleared.some((c) => c.side === item.side && c.price === item.price)) {
        combinedCleared.push({
          ...item,
          clearedAt: now,
          expiresAt: now + this.ttlMs,
          ttlMs: this.ttlMs
        });
      }
    }

    for (const ev of combinedCleared) {
      const key = ev.side + ':' + ev.price;
      const prior = this.clearedByKey.get(key);
      const peakPrev = prior ? Math.max(prior.prevSize, ev.prevSize) : ev.prevSize;
      this.clearedByKey.set(key, {
        ...ev,
        prevSize: peakPrev,
        deltaSize: Math.max(ev.deltaSize, peakPrev - ev.nextSize),
        clearedAt: now,
        expiresAt: now + this.ttlMs,
        ttlMs: this.ttlMs
      });
    }

    for (const wall of diff.addedWalls) {
      const key = wall.side + ':' + wall.price;
      this.wallsByKey.set(key, wall);
    }

    while (this.clearedByKey.size > this.maxActive) {
      const oldestKey = this.clearedByKey.keys().next().value;
      this.clearedByKey.delete(oldestKey);
    }
    while (this.wallsByKey.size > this.maxActive) {
      const oldestKey = this.wallsByKey.keys().next().value;
      this.wallsByKey.delete(oldestKey);
    }

    this.previousBook = normalized;
    return {
      clearedLevels: combinedCleared,
      addedWalls: diff.addedWalls,
      activeCleared: this.activeAt(now),
      activeWalls: this.activeWallsAt(now)
    };
  }

  injectCleared(events, now = Date.now()) {
    this.prune(now);
    if (!Array.isArray(events)) return this.activeAt(now);
    for (const raw of events) {
      if (!raw || !Number.isFinite(raw.price) || raw.price <= 0) continue;
      const side = raw.side === 'ask' || raw.side === 'sell' ? 'ask' : 'bid';
      const prevSize = Math.max(1e-8, Number(raw.prevSize ?? raw.deltaSize ?? raw.size ?? 1));
      const nextSize = Math.max(0, Number(raw.nextSize ?? 0));
      const key = side + ':' + raw.price;
      this.clearedByKey.set(key, {
        side,
        price: Number(raw.price),
        prevSize,
        nextSize,
        deltaSize: Math.max(0, prevSize - nextSize),
        clearedRatio: prevSize > 0 ? Math.min(1, Math.max(0.25, (prevSize - nextSize) / prevSize)) : 1,
        kind: nextSize === 0 ? 'wiped' : 'swept',
        clearedAt: now,
        expiresAt: now + this.ttlMs,
        ttlMs: this.ttlMs
      });
    }
    return this.activeAt(now);
  }

  activeAt(now = Date.now()) {
    this.prune(now);
    const out = [];
    for (const item of this.clearedByKey.values()) {
      const decay = Math.max(0, Math.min(1, (item.expiresAt - now) / item.ttlMs));
      if (decay > 0) out.push({ ...item, decay });
    }
    return out;
  }

  activeWallsAt(now = Date.now()) {
    this.prune(now);
    const out = [];
    for (const item of this.wallsByKey.values()) {
      const decay = Math.max(0, Math.min(1, (item.expiresAt - now) / item.ttlMs));
      if (decay > 0) out.push({ ...item, decay });
    }
    return out;
  }

  hasActive(now = Date.now()) {
    this.prune(now);
    return this.clearedByKey.size > 0 || this.wallsByKey.size > 0;
  }
}

/**
 * Decorates visible orderbook ladder levels with OG bitcoinwisdom.com clearing/sweep/wall state
 * and cumulative depth percentages while keeping fixed ladder slot counts stable.
 */
export function annotateOrderBookLadder(levels, side, activeCleared = [], activeWalls = [], maxRows = 10) {
  const normalizedSide = side === 'ask' ? 'ask' : 'bid';
  const liveRows = (Array.isArray(levels) ? levels : []).slice(0, maxRows).map(([price, size]) => ({
    price: Number(price),
    size: Number(size),
    status: 'normal',
    decay: 0,
    prevSize: Number(size)
  }));

  const clearedMap = new Map();
  for (const c of activeCleared) {
    if (c.side === normalizedSide) clearedMap.set(c.price, c);
  }
  const wallMap = new Map();
  for (const w of activeWalls) {
    if (w.side === normalizedSide) wallMap.set(w.price, w);
  }

  for (const row of liveRows) {
    const swept = clearedMap.get(row.price);
    const wall = wallMap.get(row.price);
    if (swept) {
      row.status = swept.kind === 'wiped' ? 'wiped' : 'swept';
      row.decay = swept.decay;
      row.prevSize = swept.prevSize;
    } else if (wall) {
      row.status = 'wall';
      row.decay = wall.decay;
      row.prevSize = wall.prevSize;
    }
  }

  // If a top-of-book or inside level was completely wiped out (size -> 0), overlay up to 2 transient
  // strike-out ghost rows in-place on the outermost tail slot so total DOM row count stays constant.
  const wipedInside = activeCleared
    .filter((c) => c.side === normalizedSide && c.kind === 'wiped' && !liveRows.some((r) => r.price === c.price))
    .sort((a, b) => normalizedSide === 'bid' ? b.price - a.price : a.price - b.price)
    .slice(0, 2);

  if (wipedInside.length && liveRows.length >= 3) {
    const combined = [
      ...liveRows.slice(0, Math.max(1, liveRows.length - wipedInside.length)),
      ...wipedInside.map((w) => ({
        price: w.price,
        size: 0,
        status: 'wiped',
        decay: w.decay,
        prevSize: w.prevSize
      }))
    ];
    combined.sort((a, b) => normalizedSide === 'bid' ? b.price - a.price : a.price - b.price);
    liveRows.splice(0, liveRows.length, ...combined.slice(0, maxRows));
  }

  let cumulative = 0;
  let ghostCumulative = 0;
  for (const row of liveRows) {
    cumulative += row.size;
    ghostCumulative += Math.max(row.size, row.prevSize * (row.status === 'wiped' || row.status === 'swept' ? row.decay : 0));
    row.cumulative = cumulative;
    row.ghostCumulative = ghostCumulative;
  }
  const peak = Math.max(1e-10, ghostCumulative, cumulative);
  for (const row of liveRows) {
    row.depthPct = Math.min(100, (row.cumulative / peak) * 100);
    row.ghostPct = row.status === 'wiped' || row.status === 'swept'
      ? Math.min(100, (row.ghostCumulative / peak) * 100)
      : 0;
  }
  return liveRows;
}

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
  constructor(market = 'spot', callbacks = {}, {
    maxBuffered = 4096,
    maxLevels = 1000,
    clearTtlMs = DEFAULT_CLEAR_TTL_MS,
    sweepRatio = DEFAULT_SWEEP_RATIO
  } = {}) {
    if (!['spot', 'futures'].includes(market)) throw new RangeError('Invalid market');
    this.market = market;
    this.callbacks = callbacks;
    this.maxBuffered = maxBuffered;
    this.maxLevels = maxLevels;
    this.clearTtlMs = Math.min(500, Math.max(350, clearTtlMs));
    this.sweepRatio = sweepRatio;
    this.reset('initial', false);
  }

  reset(reason = 'disconnected', notify = true) {
    this.bids = new Map();
    this.asks = new Map();
    this.lastUpdateId = null;
    this.lastClearedLevels = [];
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
    this.lastClearedLevels = [];
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

    const cleared = [];
    const applyDeltaSide = (map, updates, side) => {
      for (const [price, size] of updates) {
        const prevSize = map.get(price) ?? 0;
        if (prevSize > 0 && size === 0) {
          cleared.push({
            side, price, prevSize, nextSize: 0, deltaSize: prevSize,
            clearedRatio: 1, kind: 'wiped',
            clearedAt: event.time, expiresAt: event.time + this.clearTtlMs, ttlMs: this.clearTtlMs
          });
        } else if (prevSize > 0 && size < prevSize && (prevSize - size) / prevSize + 1e-12 >= this.sweepRatio) {
          cleared.push({
            side, price, prevSize, nextSize: size, deltaSize: prevSize - size,
            clearedRatio: (prevSize - size) / prevSize, kind: 'swept',
            clearedAt: event.time, expiresAt: event.time + this.clearTtlMs, ttlMs: this.clearTtlMs
          });
        }
        if (size === 0) map.delete(price);
        else map.set(price, size);
      }
    };

    applyDeltaSide(this.bids, event.bids, 'bid');
    applyDeltaSide(this.asks, event.asks, 'ask');

    this.lastUpdateId = event.u;
    this.lastClearedLevels = cleared;
    this.phase = 'live';
    this.trim();
    const book = this.snapshot(event.time);
    if (book.bids.length && book.asks.length && book.bids[0][0] >= book.asks[0][0]) {
      this.reset('crossed local book');
      return 'resync';
    }
    this.callbacks.onStatus?.('live');
    if (cleared.length) this.callbacks.onLevelsCleared?.(cleared, book);
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
      asks: [...this.asks].sort((a, b) => a[0] - b[0]).slice(0, this.maxLevels),
      clearedLevels: this.lastClearedLevels
    };
  }
}
