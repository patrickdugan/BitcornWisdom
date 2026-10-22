# Architecture v0.8

Binance Spot/Futures REST history and WS kline/trades, Kraken REST OHLC / WS v2, and Coinbase Exchange REST candles / public WebSocket matches all supply a normalized candle/trade model to the dependency-free Canvas2D chart.

Binance L2 flows from a dedicated public depth WebSocket through an IO-free state machine. The stream buffers events before a REST snapshot is retrieved, requires an overlapping first update, validates spot U/u or futures U/u/pu sequence continuity, and invalidates its maps when a gap is detected. The supervising BinanceDepthStream fetches another snapshot after resynchronization. The futures high-frequency feed uses the 2026 /public route; candles and aggregate trades use /market.

Kraken L2 uses the 25-level WebSocket v2 book subscription. Price and quantity spellings are preserved before JSON float conversion so the official top-ten CRC32 matches. On a checksum mismatch, the local state is destroyed and the socket reconnects.

Coinbase book initialization consumes a public `level2_batch` snapshot and then applies absolute-size changes on the same ordered socket. The browser retains up to 1,000 nearest levels per side. Trade messages extend the current OHLCV bar, with `heartbeat.last_trade_id` compared against observed match IDs to request a REST refresh after persistent gaps. Coinbase does not offer an L2 CRC32 equivalent.

All book feeds drive the 10-by-10 bid/ask ladder and a sampled heatmap. Near-mid liquidity is binned at about one-second intervals into at most 200 bands and 160 time columns.

The v0.6 market desk adds a framework-free workspace layer: src/workspace.js validates themes and favorites and defines command-search scoring and Canvas palettes, while src/workspace-ui.js implements the local watchlist, command palette, panel visibility, theme persistence and PNG chart export. Market shortcuts are scoped by venue/symbol, and only the active market opens public feed subscriptions.

The Canvas2D renderer now applies theme palettes directly while rendering and caches its EMA, SMA, RSI and Bollinger series until OHLCV mutates. RSI reserves a separate strip below volume. Themes remain dark to keep market colors readable.

The v0.7 drawing engine separates serializable chart geometry in src/drawings.js from Canvas rendering. Each annotation has a validated type (line, horizontal, vertical, fib) and price/time endpoints. Untyped v0.6 trend lines migrate as line annotations. The geometry module supplies bounded hit testing, semantic translation and seven Fibonacci prices; src/chart.js owns cursor snapping, selectable anchors, pointer editing, fifty-step undo history and the existing per-market/timeframe localStorage callback. Drawings are capped at 200. No chart annotations are sent to market-data exchanges.

Version 0.8 introduces src/chart-grid-core.js (pure layout preference validation, time/index interpolation and cross-interval viewport algebra) and src/chart-grid.js (up to three secondary Canvas charts with separate REST loads, reconnecting market sockets, errors, timers, persistence and teardown). The primary chart continues to own L2 depth, liquidity recording and the trade tape. Secondary panes use candle-only Kraken WebSocket subscriptions, lightweight Coinbase match/heartbeat subscriptions, or Binance public chart streams; they do not duplicate whole order-book downloads or full-depth sockets. Hiding a pane aborts pending requests, closes its socket, clears its demo timer and disconnects its ResizeObserver. Demo samples never become live market history.

Linked Time propagates the source pane's centered absolute timestamp and approximate visible duration to the other charts, compensating for their different candle periods and viewport widths. Linked Cursor transmits the absolute time coordinate only, not price. Receiver updates do not rebroadcast. Each market/timeframe retains its existing local drawing namespace and indicator choices. See MULTI_CHART.md for user-visible boundaries.

The chart consumes normalized UTC millisecond OHLCV and uses the same coordinate transform for candles, indicators, cursor and persisted line drawings. It triggers older-history callbacks when viewport navigation approaches the earliest stored candle. Binance uses an oldest-exclusive REST endTime cursor, while Coinbase requests bounded time ranges. Inserting older bars at the front preserves x positions of already visible candles. Up to 8,000 candles are retained in browser memory, and session generation guards prevent stale historical fetches from changing a newly selected market. One active market session owns its REST controller and sockets. Market switching closes prior feeds and blocks stale updates.

A future backend is justified for historical L2 retention, replay or multi-venue aggregation. At present all market access is public, read-only and direct from the browser, with no credentials or account state.

Unit tests cover numerical transforms, parsing, order-book snapshot overlap, sequence gaps, Kraken official CRC32 sample, Coinbase snapshot/update and heartbeat gap handling, candle upserts, depth binning, paged REST cursors, viewport preservation, and cancellation races. The offline browser smoke is distinct from a live endpoint probe, where regional HTTP errors are recorded.


## Local liquidity recorder and replay

Each live verified order book produces a sampled, sparse price-binned column no more than about once per second. A sample includes the local observation timestamp, optional market event timestamp, venue/source identity, midprice and at most 200 approximate base-quantity bins within ±1% of the observed price.

The LiquidityArchive implementation uses browser IndexedDB, a compound (series, timestamp) key, and an absolute-time secondary index for retention pruning. Archive series include demo/live, exchange and symbol, independent of the candle interval. The UI loads the latest 6,000 columns for replay. IndexedDB targets a total cap of 12,000 across all stored markets, removes rows older than 24 hours, and prunes after every 64 writes and during restoration. The browser controls any eventual eviction or storage denial.

The LiquidityHeatmap object owns an independent replay cursor by timestamp. It renders at most 160 columns around the cursor, retains its latest live samples while replay is paused, and marks gaps over four seconds without drawing a connecting price line. Seeking, playback speed, Live and Erase affect the sample timeline; the price chart, trade tape and order-book ladder remain live.

The archive stores *binned snapshots*, not lossless diff-depth messages. Reconstructing historical book state outside observed samples would require a continuously running separate recorder and event-log storage. No such background collector exists. The UI explicitly labels this as local, sampled depth.

Use npm run smoke:archive for Chromium IndexedDB persistence, timeline seeking, playback, venue isolation, erase, expiry and global-cap checks in a disposable profile.
