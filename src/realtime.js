// Shared reconnecting transport for public market-data sockets.
// Browser-native WebSocket performs protocol ping/pong automatically.
export class ReconnectingSocket {
  constructor(url, callbacks = {}, factory = (address) => new WebSocket(address)) {
    this.url = url;
    this.callbacks = callbacks;
    this.factory = factory;
    this.socket = null;
    this.timer = null;
    this.attempts = 0;
    this.closed = false;
    this.generation = 0;
  }

  start() {
    this.connect();
    return this;
  }

  connect() {
    if (this.closed) return;
    const generation = ++this.generation;
    this.callbacks.onStatus?.('connecting');
    let ws;
    try { ws = this.factory(this.url); }
    catch (error) {
      this.callbacks.onError?.(error);
      this.scheduleRetry(generation);
      return;
    }
    this.socket = ws;
    ws.onopen = () => {
      if (this.closed || this.socket !== ws) return;
      this.attempts = 0;
      this.callbacks.onStatus?.('live');
      try { this.callbacks.onOpen?.(ws); }
      catch (error) { this.callbacks.onError?.(error); ws.close(); }
    };
    ws.onmessage = (event) => {
      if (this.closed || this.socket !== ws) return;
      try { this.callbacks.onMessage?.(event.data); }
      catch (error) { this.callbacks.onError?.(error); }
    };
    ws.onerror = () => {
      if (this.closed || this.socket !== ws) return;
      this.callbacks.onStatus?.('disrupted');
    };
    ws.onclose = () => {
      if (this.closed || this.socket !== ws) return;
      this.socket = null;
      this.callbacks.onClose?.();
      this.scheduleRetry(generation);
    };
  }

  scheduleRetry(generation) {
    if (this.closed || generation !== this.generation) return;
    this.callbacks.onStatus?.('reconnecting');
    const delay = Math.min(30_000, 1000 * (2 ** Math.min(this.attempts++, 5))) +
      Math.floor(Math.random() * 400);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.closed && generation === this.generation) this.connect();
    }, delay);
  }

  reconnect() {
    if (this.closed) return;
    const ws = this.socket;
    if (ws && ws.readyState < 2) ws.close();
    else if (!ws && this.timer === null) this.scheduleRetry(this.generation);
  }

  close() {
    this.closed = true;
    ++this.generation;
    clearTimeout(this.timer);
    this.timer = null;
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;
      this.socket.onopen = null;
      this.socket.close();
      this.socket = null;
    }
  }
}
