// Persistent *sampled* L2 liquidity columns. This stores binned, observed depth,
// never a reconstructed historical exchange order book or raw diff-depth events.
// IndexedDB keeps distinct exchange/market/symbol/demo series isolated.

export const ARCHIVE_POLICY = Object.freeze({
  version: 1,
  retentionMs: 24 * 60 * 60 * 1000,
  maxTotal: 12000,
  maxLoaded: 6000,
  pruneEvery: 64
});

export function liquiditySeriesKey(market, symbol, demo = false) {
  if (!/^(spot|futures|kraken|coinbase)$/.test(market) ||
      !/^[A-Z0-9]{4,24}$/.test(symbol)) throw new RangeError('Invalid liquidity series');
  return (demo ? 'demo' : 'live') + ':' + market + ':' + symbol;
}

export function validLiquiditySample(record) {
  return record && record.version === ARCHIVE_POLICY.version &&
    typeof record.series === 'string' && /^(live|demo):(spot|futures|kraken|coinbase):[A-Z0-9]{4,24}$/.test(record.series) &&
    Number.isSafeInteger(record.at) && record.at >= 0 &&
    Number.isFinite(record.price) && record.price > 0 &&
    (record.exchangeAt === null || (Number.isFinite(record.exchangeAt) && record.exchangeAt >= 0)) &&
    typeof record.source === 'string' && record.source.length <= 64 &&
    Array.isArray(record.levels) && record.levels.length <= 200 &&
    record.levels.every((level) => Array.isArray(level) && level.length === 2 &&
      Number.isFinite(level[0]) && level[0] > 0 &&
      Number.isFinite(level[1]) && level[1] >= 0);
}

export function combineLiquiditySamples(stored, incoming, limit = ARCHIVE_POLICY.maxLoaded) {
  if (!Number.isInteger(limit) || limit <= 0) throw new RangeError('Invalid archive window');
  const combined = new Map();
  for (const row of [...stored, ...incoming]) {
    if (validLiquiditySample(row)) combined.set(row.at, row);
  }
  return [...combined.values()].sort((a, b) => a.at - b.at).slice(-limit);
}

export function liquidityWindow(rows, endIndex = rows.length - 1, columns = 160) {
  if (!rows.length) return [];
  const end = Math.max(0, Math.min(rows.length - 1, Math.floor(endIndex)));
  return rows.slice(Math.max(0, end - columns + 1), end + 1);
}

function completion(tx, resolve, reject, value = undefined) {
  tx.oncomplete = () => resolve(value);
  tx.onerror = () => reject(tx.error || new Error('Liquidity storage transaction failed'));
  tx.onabort = () => reject(tx.error || new Error('Liquidity storage transaction aborted'));
}

export class LiquidityArchive {
  constructor({
    api = globalThis.indexedDB,
    ranges = globalThis.IDBKeyRange,
    name = 'bitcornwisdom-liquidity-v1',
    maxTotal = ARCHIVE_POLICY.maxTotal,
    maxLoaded = ARCHIVE_POLICY.maxLoaded,
    retentionMs = ARCHIVE_POLICY.retentionMs
  } = {}) {
    this.api = api;
    this.ranges = ranges;
    this.name = name;
    this.maxTotal = maxTotal;
    this.maxLoaded = maxLoaded;
    this.retentionMs = retentionMs;
    this.db = null;
    this.openPromise = null;
    this.writes = 0;
  }

  open() {
    if (this.db) return Promise.resolve(this.db);
    if (this.openPromise) return this.openPromise;
    if (!this.api || !this.ranges) return Promise.reject(new Error('IndexedDB unavailable'));
    this.openPromise = new Promise((resolve, reject) => {
      const req = this.api.open(this.name, ARCHIVE_POLICY.version);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('samples')) {
          const store = db.createObjectStore('samples', { keyPath: ['series', 'at'] });
          store.createIndex('byAt', 'at', { unique: false });
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        this.db.onversionchange = () => {
          this.db.close();
          this.db = null;
          this.openPromise = null;
        };
        resolve(this.db);
      };
      req.onerror = () => reject(req.error || new Error('Could not open liquidity archive'));
      req.onblocked = () => reject(new Error('Liquidity database is blocked by another tab'));
    }).catch((error) => {
      this.openPromise = null;
      throw error;
    });
    return this.openPromise;
  }

  async save(row) {
    if (!validLiquiditySample(row)) throw new TypeError('Invalid liquidity sample');
    const db = await this.open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('samples', 'readwrite');
      tx.objectStore('samples').put(row);
      completion(tx, resolve, reject);
    });
    if (++this.writes % ARCHIVE_POLICY.pruneEvery === 0) await this.prune();
    return row;
  }

  async load(series, { limit = this.maxLoaded, now = Date.now() } = {}) {
    if (typeof series !== 'string' || !/^(live|demo):/.test(series)) {
      throw new RangeError('Invalid liquidity series');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > this.maxLoaded) {
      throw new RangeError('Invalid history load limit');
    }
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('samples', 'readonly');
      const range = this.ranges.bound([series, 0], [series, Number.MAX_SAFE_INTEGER]);
      const req = tx.objectStore('samples').openCursor(range, 'prev');
      const found = [];
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur || found.length >= limit) return;
        if (cur.value.at >= now - this.retentionMs &&
            validLiquiditySample(cur.value)) found.push(cur.value);
        cur.continue();
      };
      completion(tx, () => resolve(found.reverse()), reject);
    });
  }

  async clearSeries(series) {
    const db = await this.open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('samples', 'readwrite');
      const range = this.ranges.bound([series, 0], [series, Number.MAX_SAFE_INTEGER]);
      const req = tx.objectStore('samples').openCursor(range);
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        cur.delete();
        cur.continue();
      };
      completion(tx, resolve, reject);
    });
  }

  /** A global quota keeps multiple visited markets from growing without bound. */
  async prune(now = Date.now()) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('samples', 'readwrite');
      const store = tx.objectStore('samples');
      const req = store.count();
      let deleted = 0;
      req.onsuccess = () => {
        let excess = Math.max(0, req.result - this.maxTotal);
        const cursor = store.index('byAt').openCursor();
        cursor.onsuccess = () => {
          const cur = cursor.result;
          if (!cur) return;
          if (cur.value.at < now - this.retentionMs || excess > 0) {
            cur.delete();
            deleted++;
            excess = Math.max(0, excess - 1);
            cur.continue();
          }
        };
      };
      completion(tx, () => resolve(deleted), reject);
    });
  }

  close() {
    if (this.db) this.db.close();
    this.db = null;
    this.openPromise = null;
  }
}
