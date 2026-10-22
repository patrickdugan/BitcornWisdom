import { feedProvenance, normalizeCandle, normalizeHistory } from './feed-policy.js';

// A single-owner feed session. Failover is deliberate and visible: only one
// eligible provider may publish chart observations at a time.
export class FeedRouter {
  constructor({ sources, openSource, onSource = () => {}, onHistory = () => {},
    onCandle = () => {}, onStatus = () => {}, onError = () => {},
    clock = () => Date.now(), schedule = setInterval, cancel = clearInterval,
    checkEveryMs = 1000, staleMs = 30000, disruptedGraceMs = 3000,
    connectTimeoutMs = 12000, retryMs = 10000 } = {}) {
    if (!Array.isArray(sources) || !sources.length || sources.some(x => !x?.id))
      throw new TypeError('FeedRouter requires a nonempty eligible source list');
    if (typeof openSource !== 'function') throw new TypeError('Missing feed adapter');
    this.sources = sources.map(source => ({ ...source }));
    this.openSource = openSource;
    this.onSource = onSource;
    this.onHistory = onHistory;
    this.onCandle = onCandle;
    this.onStatus = onStatus;
    this.onError = onError;
    this.clock = clock;
    this.schedule = schedule;
    this.cancel = cancel;
    this.checkEveryMs = checkEveryMs;
    this.staleMs = staleMs;
    this.disruptedGraceMs = disruptedGraceMs;
    this.connectTimeoutMs = connectTimeoutMs;
    this.retryMs = retryMs;
    this.running = false;
    this.generation = 0;
    this.index = -1;
    this.phase = 'idle';
    this.controller = null;
    this.handle = null;
    this.timer = null;
    this.lastPacketAt = 0;
    this.lastHeartbeatAt = 0;
    this.disruptedAt = null;
    this.attemptStartedAt = 0;
    this.retryAt = 0;
    this.lastReason = 'initial';
  }

  get source() { return this.sources[this.index] || null; }

  snapshot() {
    return {
      state: this.phase, reason: this.lastReason,
      source: this.source ? feedProvenance(this.source, {
        state: this.phase, reason: this.lastReason, receivedAt: this.lastPacketAt || null
      }) : null,
      eligibleSources: this.sources.length
    };
  }

  report(state, reason = this.lastReason) {
    this.phase = state;
    this.lastReason = reason;
    this.onStatus(this.snapshot());
  }

  active(ticket) {
    return this.running && this.generation === ticket;
  }

  cleanup() {
    this.controller?.abort();
    this.controller = null;
    this.handle?.close?.();
    this.handle = null;
  }

  async start() {
    if (this.running) return false;
    this.running = true;
    this.timer = this.schedule(() => this.check(), this.checkEveryMs);
    return this.connectFrom(0, 'initial');
  }

  async connectFrom(first, reason) {
    if (!this.running) return false;
    const ticket = ++this.generation;
    this.cleanup();
    this.report('connecting', reason);
    for (let step = 0; step < this.sources.length; step++) {
      if (!this.active(ticket)) return false;
      const index = (first + step) % this.sources.length;
      const source = this.sources[index];
      const controller = new AbortController();
      this.controller = controller;
      this.index = index;
      this.attemptStartedAt = this.clock();
      this.lastPacketAt = 0;
      this.lastHeartbeatAt = 0;
      this.disruptedAt = null;
      const selectedReason = step === 0 ? reason : 'source-error';
      this.lastReason = selectedReason;
      this.report('connecting', selectedReason);
      this.onSource(this.snapshot());
      const accepts = () => this.active(ticket) && !controller.signal.aborted;
      const callbacks = {
        onHistory: rows => {
          if (!accepts()) return;
          // A malformed initial history must fail the whole candidate source,
          // allowing the next eligible provider to take over.
          this.onHistory(normalizeHistory(rows), source);
        },
        onCandle: row => {
          if (!accepts()) return;
          try {
            const candle = normalizeCandle(row);
            this.lastPacketAt = this.clock();
            this.disruptedAt = null;
            if (this.phase !== 'live') this.report('live', selectedReason);
            this.onCandle(candle, source);
          } catch (error) { this.onError(error, source); }
        },
        onHeartbeat: () => {
          if (accepts()) this.lastHeartbeatAt = this.clock();
        },
        onStatus: state => {
          if (!accepts()) return;
          if (state === 'live') {
            this.lastHeartbeatAt = this.clock();
            this.disruptedAt = null;
            this.report('live', selectedReason);
          } else if (['disrupted', 'reconnecting', 'error'].includes(state)) {
            this.disruptedAt ??= this.clock();
            this.report('disrupted', state);
          } else if (state === 'connecting') {
            this.report('connecting', selectedReason);
          }
        },
        onError: error => {
          if (accepts()) this.onError(error, source);
        }
      };
      try {
        const handle = await this.openSource(source, callbacks, controller.signal);
        if (!accepts()) {
          handle?.close?.();
          return false;
        }
        this.handle = handle || { close() {} };
        return true;
      } catch (error) {
        if (!this.active(ticket)) return false;
        controller.abort();
        this.controller = null;
        this.onError(error, source);
      }
    }
    if (!this.active(ticket)) return false;
    this.index = -1;
    this.retryAt = this.clock() + this.retryMs;
    this.report('unavailable', 'all-sources-failed');
    this.onSource(this.snapshot());
    return false;
  }

  check() {
    if (!this.running) return;
    const now = this.clock();
    if (this.phase === 'unavailable' && now >= this.retryAt) {
      void this.connectFrom(0, 'retry');
      return;
    }
    if (this.phase === 'connecting' && now - this.attemptStartedAt > this.connectTimeoutMs) {
      void this.failover('connect-timeout');
      return;
    }
    if (this.phase === 'disrupted' && this.disruptedAt !== null &&
      now - this.disruptedAt >= this.disruptedGraceMs) {
      void this.failover('socket-disconnected');
      return;
    }
    // Exchange OHLCV messages can be quiet while no trades occur. Our router
    // marks prolonged silence as stale and deliberately tests the next source.
    if (this.phase === 'live' &&
      now - (this.lastPacketAt || this.lastHeartbeatAt || this.attemptStartedAt) > this.staleMs) {
      this.report('stale', 'missing-live-candles');
      void this.failover('missing-live-candles');
    }
  }

  async failover(reason = 'operator-request') {
    if (!this.running) return false;
    const next = this.index < 0 ? 0 : (this.index + 1) % this.sources.length;
    return this.connectFrom(next, reason);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    ++this.generation;
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    this.cleanup();
    this.index = -1;
    this.report('stopped', 'closed');
  }
}
