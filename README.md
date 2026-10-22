# BitcornWisdom

An independent MIT-licensed market terminal inspired by BitcoinWisdom, built with native browser modules, Canvas2D, and **zero npm dependencies**.

Version 0.5 includes Binance Spot, Binance USDⓈ-M Futures, Kraken Spot, and Coinbase Exchange Spot, with cursor-based older-candle loading for Binance and Coinbase, plus a locally persistent liquidity timeline. It has OHLC candles, volume, EMA20/SMA50, log scale, wheel zoom, drag pan, keyboard controls, crosshair, locally saved trend lines, trades, a verified order-book display and a live liquidity heatmap. No account, wallet, exchange key or TradingView library is required.

## Getting started

Requires Node.js 20+.

    git clone https://github.com/patrickdugan/BitcornWisdom.git
    cd BitcornWisdom
    npm start

Open http://127.0.0.1:5173/ for live public feeds, or http://127.0.0.1:5173/?demo=1 for the deterministic offline demo.

    npm run check
    npm run smoke
    npm run smoke:archive
    npm run probe:live
    npm run browser:live

The check script runs source syntax checks and 52 deterministic unit tests; smoke validates offline-demo hydration in Chrome. The archive smoke opens a temporary Chrome profile, saves depth samples in IndexedDB, reloads, seeks through replay, checks venue isolation and tests Erase. The live probe checks public REST/WebSocket endpoints and writes live-probe.json with reachability results. It is diagnostic and subject to regional blocking.

## Markets

| Market | Symbol | Candles | Trades | Book |
| --- | --- | --- | --- | --- |
| Binance Spot | BTCUSDT | Public REST + WS kline | Raw trades | REST snapshot + diff-depth sequence verification |
| Binance USDⓈ-M | BTCUSDT | Futures REST + WS kline | aggTrade | Futures depth using U/u/pu continuity |
| Kraken Spot | BTCUSD | REST OHLC + WS v2 | WS v2 trades | WS v2 25-level book with top-ten CRC32 verification |
| Coinbase Exchange | BTCUSD | REST candles (300-bar max) + live matches | Exchange matches | Unauthenticated level2_batch snapshot and updates, capped locally at 1,000 levels |

Kraken and Coinbase accept joined symbols such as BTCUSD and ETHUSD. Kraken supports 1m, 5m, 15m, 30m, 1h, 4h, 1d and 1w; Coinbase supports 1m, 5m, 15m, 1h, 6h and 1d. The selector disables unsupported intervals. Coinbase REST history returns up to 300 recent candles per request and its live candles are extended from individual exchange trades. **Panning toward the oldest visible bar automatically requests another historical page** on Binance and Coinbase, with an 8,000-candle browser-memory cap. Kraken's recent OHLC endpoint has a fixed venue-side limit, so older paging is unavailable there.

For Binance, the initial depth snapshot is limited to **1,000 known price levels per side**. The application buffers incremental depth events, validates the overlap with the REST snapshot and resynchronizes on missing IDs. This is a bounded synchronized local book, not the full exchange book at arbitrary price distances. Kraken maintains 25 levels and checks CRC32. On checksum failure, the book is cleared and the public socket reconnects. Coinbase consumes exchange snapshot-fed Level 2 updates and keeps the nearest 1,000 known levels. Coinbase does not supply an equivalent CRC32 guarantee; dropped trade messages are monitored using the heartbeat last-trade ID, with automatic REST candle refresh after persistent gaps.

The heatmap records roughly one observed column per second and bins near-mid liquidity into at most 200 price buckets over a ±1% band. **v0.5 saves timestamped samples to IndexedDB**, scoped by live/demo, exchange and symbol. After a reload it restores up to 6,000 timeline samples and displays 160 at a time, with Play/Pause, 1×/4×/16× speed, a seek slider and a Live button. It caps storage at about 12,000 rows globally and prunes observations older than 24 hours. Recording occurs only while this browser tab receives depth events. Missing observation periods are marked on the heatmap. These are sampled, binned observations; exact raw order-book event replay and cross-exchange aggregation remain future work. See [Liquidity replay](docs/LIQUIDITY_REPLAY.md).

## Controls

- Wheel zooms beneath the cursor; drag pans.
- Focus the chart for arrow-key pan/zoom, then Home to reset. Panning left near the historical edge requests older Binance/Coinbase candles. Older pages preserve the chart's existing x positions.
- Select Line and click twice to draw; Esc cancels and Ctrl+Z undoes.
- EMA, SMA, LOG toggles persist in localStorage.
- Market, timeframe and per-market drawings are stored locally.
- Replay previously recorded depth by clicking Replay, dragging the timeline slider and pressing Play. Use Live to follow current observations. Erase deletes the selected market's local archive after confirmation.

## Implementation

The source files are arranged by task:

- src/chart.js: Canvas rendering, scales, drawing, and bounded older-candle buffering.
- src/core.js and src/indicators.js: shared OHLCV and indicators.
- src/binance.js: Binance public REST and WS, separated 2026 market/public stream routing.
- src/orderbook.js: deterministic snapshot and delta reconciliation.
- src/kraken.js: REST candles, WS v2 trades and CRC32-verified book.
- src/coinbase.js: Coinbase REST, public WS matches/heartbeat, snapshot-fed L2.
- src/realtime.js: shared reconnecting WebSocket transport.
- src/heatmap.js: bounded aggregation, gap-aware rendering and replay.
- src/liquidity-archive.js: versioned IndexedDB depth samples, age/cap cleanup and market isolation.
- src/main.js: market lifecycle and UI.
- src/demo.js: labelled synthetic market feed.

## What has been verified

In an October 22, 2026 GitHub Actions connectivity run, **eight of nine** public exchange endpoints responded with valid data: Binance Spot REST candles and trades, Binance Futures aggregate trades and sequenced depth, Kraken REST candles and a CRC32-verified Kraken WebSocket book snapshot, Coinbase REST candles and Coinbase public WebSocket book snapshot. Binance Futures REST candles returned **HTTP 451** from the runner's region. Live tests demonstrate network reachability from that host; browser CORS and other regional conditions can differ.

All 52 deterministic tests, the local-demo Chrome smoke and the IndexedDB archive smoke passed. A live Chromium integration check also loaded real candles and reached **LIVE** status with **Kraken checksum-verified**, **Binance Spot synchronized**, and **Coinbase snapshot-fed** books; all three showed book rows without page errors. Those browser screenshots and the machine-readable reports are generated as GitHub Actions artifacts. Coinbase book integrity relies on the ordered snapshot/update feed and is separately identified from cryptographically checksum-verified Kraken depth. The live Chrome pagination probe loaded 2,000 Binance candles and 650 Coinbase candles after simulated left-arrow navigation. The archive browser test restored 107 synthetic market samples after reload, verified replay and erase, and confirmed that another venue's archive remained independent. Longer-duration depth soak and additional regional browsers remain on the roadmap.

See docs/NETWORK_MODEL.md, docs/ARCHITECTURE.md, docs/FEATURE_MATRIX.md and docs/MVP_SPEC.md for protocol notes, build decisions and limitations.

## License and provenance

MIT. Independent of BitcoinWisdom.com and BitcoinWisdom.io. The public [grossman8/bitcoin-wisdom-chart](https://github.com/grossman8/bitcoin-wisdom-chart) (MIT, Copyright 2020 Grossman) was examined as a behavior reference; its source code was not copied. See THIRD_PARTY_NOTICES.md.
