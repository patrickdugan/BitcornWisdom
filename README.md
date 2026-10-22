# BitcornWisdom

An independent MIT-licensed market terminal inspired by BitcoinWisdom, built with native browser modules, Canvas2D, and **zero npm dependencies**.

Version 0.2 includes Binance Spot, Binance USDⓈ-M Futures, and Kraken Spot. It has OHLC candles, volume, EMA20/SMA50, log scale, wheel zoom, drag pan, keyboard controls, crosshair, locally saved trend lines, trades, a verified order-book display and a live liquidity heatmap. No account, wallet, exchange key or TradingView library is required.

## Getting started

Requires Node.js 20+.

    git clone https://github.com/patrickdugan/BitcornWisdom.git
    cd BitcornWisdom
    npm start

Open http://127.0.0.1:5173/ for live public feeds, or http://127.0.0.1:5173/?demo=1 for the deterministic offline demo.

    npm run check
    npm run smoke
    npm run probe:live

The check script runs source syntax checks and 29 deterministic unit tests; smoke validates offline-demo hydration in Chrome. The live probe checks public REST/WebSocket endpoints and writes live-probe.json with reachability results. It is diagnostic and subject to regional blocking.

## Markets

| Market | Symbol | Candles | Trades | Book |
| --- | --- | --- | --- | --- |
| Binance Spot | BTCUSDT | Public REST + WS kline | Raw trades | REST snapshot + diff-depth sequence verification |
| Binance USDⓈ-M | BTCUSDT | Futures REST + WS kline | aggTrade | Futures depth using U/u/pu continuity |
| Kraken Spot | BTCUSD | REST OHLC + WS v2 | WS v2 trades | WS v2 25-level book with top-ten CRC32 verification |

Kraken accepts joined symbols such as BTCUSD and ETHUSD. Its supported intervals are 1m, 5m, 15m, 30m, 1h, 4h, 1d and 1w; the selector disables unsupported intervals.

For Binance, the initial depth snapshot is limited to **1,000 known price levels per side**. The application buffers incremental depth events, validates the overlap with the REST snapshot and resynchronizes on missing IDs. This is a bounded synchronized local book, not the full exchange book at arbitrary price distances. Kraken maintains 25 levels and checks CRC32. On checksum failure, the book is cleared and the public socket reconnects.

The heatmap records about one column per second, bins near-mid liquidity into 200 price buckets over a ±1% band, and retains up to 160 columns. It begins when the page opens. Neither full historical depth replay nor cross-exchange aggregation is implemented.

## Controls

- Wheel zooms beneath the cursor; drag pans.
- Focus the chart for arrow-key pan/zoom, then Home to reset.
- Select Line and click twice to draw; Esc cancels and Ctrl+Z undoes.
- EMA, SMA, LOG toggles persist in localStorage.
- Market, timeframe and per-market drawings are stored locally.

## Implementation

The source files are arranged by task:

- src/chart.js: Canvas rendering, scales and drawing.
- src/core.js and src/indicators.js: shared OHLCV and indicators.
- src/binance.js: Binance public REST and WS, separated 2026 market/public stream routing.
- src/orderbook.js: deterministic snapshot and delta reconciliation.
- src/kraken.js: REST candles, WS v2 trades and CRC32-verified book.
- src/realtime.js: shared reconnecting WebSocket transport.
- src/heatmap.js: bounded aggregation and heatmap rendering.
- src/main.js: market lifecycle and UI.
- src/demo.js: labelled synthetic market feed.

## What has been verified

In an October 22, 2026 GitHub Actions connectivity run, **six of seven** public exchange endpoints responded with valid data: Binance Spot REST candles and trades, Binance Futures aggregate trades and sequenced depth, Kraken REST candles and a CRC32-verified Kraken WebSocket book snapshot. Binance Futures REST candles returned **HTTP 451** from the runner's region. Live tests demonstrate network reachability from that host; browser CORS and other regional conditions can differ.

All 29 deterministic tests and the local-demo Chrome smoke passed. Additional browser and longer-duration depth soak checks remain on the roadmap.

See docs/NETWORK_MODEL.md, docs/ARCHITECTURE.md, docs/FEATURE_MATRIX.md and docs/MVP_SPEC.md for protocol notes, build decisions and limitations.

## License and provenance

MIT. Independent of BitcoinWisdom.com and BitcoinWisdom.io. The public [grossman8/bitcoin-wisdom-chart](https://github.com/grossman8/bitcoin-wisdom-chart) (MIT, Copyright 2020 Grossman) was examined as a behavior reference; its source code was not copied. See THIRD_PARTY_NOTICES.md.
