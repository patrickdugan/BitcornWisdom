# Embed SDK and federated candle feeds (v0.11)

BitcornWisdom v0.11 adds a standalone, responsive `embed.html` chart and a
dependency-free, framework-neutral JavaScript module at `src/embed-sdk.js`.
Both are static files that can be self-hosted or served from GitHub Pages.
The iframe does its own read-only exchange requests over public REST/WS.
There is no BitcornWisdom account, vendor API key, login or managed backend.

## One-line iframe

```html
<iframe
  title="Live BTC/USD chart"
  src="https://patrickdugan.github.io/BitcornWisdom/embed.html?instrument=BTC-USD-SPOT&interval=1m&preferred=kraken"
  style="width:100%;height:420px;border:0"
  loading="lazy"
></iframe>
```

The GitHub Pages URL becomes usable **after Pages has been enabled and the
publishing workflow succeeds**. Host the same project files on any HTTPS origin
or use `npm start` locally in the meantime. Use `&demo=1` for clearly
labelled synthetic data. Without it, the iframe uses live public exchange data.

## JavaScript SDK

```html
<div id="price-chart"></div>
<script type="module">
  import { mountBitcornChart } from
    'https://patrickdugan.github.io/BitcornWisdom/src/embed-sdk.js';

  const widget = mountBitcornChart('#price-chart', {
    instrument: 'BTC-USD-SPOT',
    preferred: 'kraken',
    interval: '1m',
    theme: 'noir',
    height: '420px'
  });

  widget.on('source', ({ source, reason }) => {
    console.log('Active source:', source?.venue, reason);
  });
  widget.on('status', status => console.log(status.state));
  widget.on('candle', event => console.log(event.candle.close, event.source));
  widget.on('error', ({ message }) => console.error(message));

  await widget.ready;
  widget.setMarket('ETH-USD-SPOT', '5m');
  widget.setTheme('verdigris');
  widget.requestState();
  // widget.destroy() when your component unmounts.
</script>
```

The SDK resolves `embed.html` relative to its own module URL, so the
self-hosted path and GitHub Pages subdirectory work. Set `embedUrl` explicitly
to use a different deployment. The host page must be served over HTTP(S) to
use the SDK control channel.

The widget communicates using `window.postMessage` with both the iframe
window identity and an **exactly matching origin**. The SDK sets
`parentOrigin` automatically; the child validates this before accepting
commands. Every command is validated and errors become `error` events.
Supported methods: `on(event, handler)` (returns an unsubscribe function),
`setSelection({instrument,interval,preferred,relays,demo})`,
`setMarket(instrument, interval)`, `setTheme(theme)`, `requestState()`,
`getState()` and `destroy()`. Valid events: `ready`, `source`, `status`,
`candle`, `state`, `error`. `ready` is also a Promise. A destroyed
embed closes its connections.

## React example

```jsx
import { useEffect, useRef } from 'react';
import { mountBitcornChart } from
  'https://patrickdugan.github.io/BitcornWisdom/src/embed-sdk.js';

export default function BitcoinChart() {
  const container = useRef(null);
  useEffect(() => {
    const chart = mountBitcornChart(container.current, {
      instrument: 'BTC-USD-SPOT', interval: '1m'
    });
    return () => chart.destroy();
  }, []);
  return <div ref={container} />;
}
```

For a bundled application, vendor the MIT-licensed SDK and its static chart
assets, or point the iframe at a version-pinned copy hosted by your organization.
The framework-neutral SDK is a thin iframe controller; it does not require
loading a global charting library into the application's JavaScript realm.

## Explicit instrument equivalence

| Instrument ID | Eligible direct exchanges | Automatic failover |
| --- | --- | --- |
| `BTC-USD-SPOT` | Kraken BTC/USD, Coinbase BTC-USD | Yes |
| `ETH-USD-SPOT` | Kraken ETH/USD, Coinbase ETH-USD | Yes |
| `BTC-USDT-SPOT` | Binance Spot BTCUSDT | Additional opt-in relays only |
| `ETH-USDT-SPOT` | Binance Spot ETHUSDT | Additional opt-in relays only |
| `BTC-USDT-PERP` | Binance USDⓈ-M BTCUSDT | Additional opt-in relays only |

For USD spot markets the supported common timeframes are
`1m`, `5m`, `15m`, `1h`, `1d`. Other listed instruments have
their own interval allowlists. The feed router never silently substitutes
BTC/USDT for BTC/USD, or spot trades for perpetual futures. Each connected
source's own OHLCV remains intact. Venue prices are distinct observations,
even for the same quote currency. A new source resets the current chart
history, displays its own venue identity, and emits a `source` event.
**Failover does not splice unrelated candle histories together**.

The router performs a new history request and WebSocket subscription at every
source change, closes the previous source, and rejects callbacks from obsolete
generations. It checks live-data freshness every second. After roughly 30
seconds without new candle observations, or 3 seconds of a disrupted socket,
it tries the next eligible source. An initial history failure triggers the
next provider immediately. After exhausting sources, it labels the feed
unavailable and retries after 10 seconds. These thresholds are heuristics:
quiet markets may fail over despite a functioning connection. Feed health,
selection reasons and active venue are shown to users. Live source selection
is a best-effort availability mechanism, not an execution-grade price oracle.

## Optional self-hosted relay protocol

Operators can append **at most two** opt-in relay bases:

```text
embed.html?instrument=BTC-USD-SPOT&interval=1m&relay=https%3A%2F%2Frelay.example.org
```

The embed will first use its compatible native exchanges, then configured
relay candidates. HTTPS is required on deployed sites. For local development,
localhost/127.0.0.1 HTTP is permitted when the embed itself is served locally.
Relay URLs must have no credentials, fragments or query strings.

Your relay must expose a CORS-enabled JSON endpoint:

```text
GET https://relay.example.org/v1/candles?instrument=BTC-USD-SPOT&interval=1m&limit=900
```

```json
{
  "instrument": "BTC-USD-SPOT",
  "interval": "1m",
  "candles": [
    {"time": 1792630800000, "open": 81000, "high": 81200,
     "low": 80900, "close": 81100, "volume": 12.5}
  ]
}
```

It must also serve
`wss://relay.example.org/v1/stream?instrument=BTC-USD-SPOT&interval=1m`
with frames such as:

```json
{"type":"candle","instrument":"BTC-USD-SPOT","interval":"1m",
 "candle":{"time":1792630800000,"open":81000,"high":81200,
           "low":80900,"close":81100,"volume":12.5}}
```

Or `{"type":"heartbeat","instrument":"BTC-USD-SPOT","interval":"1m"}`.
Timestamps are Unix milliseconds. The browser requires instrument and interval
identity to match, finite valid OHLCV, history limited to 900 candles, and
WebSocket frames limited to 16 KiB. Relays have their own trust boundary.
They are labelled `RELAY` rather than appearing as verified exchanges.
Their data is **unattested** and cannot claim Kraken checksum validation or
Binance sequence continuity merely through the relay protocol. An operator
can implement signatures, event proofs or consensus as a later extension.

## Limits and QA

This SDK embeds the **candle chart**, including its own indicators,
animated candle movement, pan and zoom. It does not yet embed independent
L2 order-book panels, liquidity replay, drawing toolbars, or a federated
historical trade archive. The classic desk retains those functions and
continues to let operators choose their exchange manually. Redundancy in
v0.11 is for the embedded OHLCV feeds.

Static GitHub Pages deployments require enabling GitHub Pages with
**Settings → Pages → Source → GitHub Actions**. The Pages workflow stages
`embed.html`, `embed.css`, and the relevant JavaScript modules with the
rest of the site.

Run `npm run check` for contract and failover state-machine tests.
`npm run smoke:embed` runs the real Chrome
`embed-lab.html?demo=1` page with two independent iframes, SDK commands,
invalid-preference rejection, and forged message-origin tests. The test
captures `bitcorn-embed-lab.png` as a CI artifact. The existing
`npm run browser:live` checks the public exchange WebSocket feed paths.
For sustained deployment QA, add hourly cross-origin probes and a longer
soak test; today the browser smoke verifies short deterministic sessions.
