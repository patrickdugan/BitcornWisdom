# Architecture v0.4

Binance Spot/Futures REST history and WS kline/trades, Kraken REST OHLC / WS v2, and Coinbase Exchange REST candles / public WebSocket matches all supply a normalized candle/trade model to the dependency-free Canvas2D chart.

Binance L2 flows from a dedicated public depth WebSocket through an IO-free state machine. The stream buffers events before a REST snapshot is retrieved, requires an overlapping first update, validates spot U/u or futures U/u/pu sequence continuity, and invalidates its maps when a gap is detected. The supervising BinanceDepthStream fetches another snapshot after resynchronization. The futures high-frequency feed uses the 2026 /public route; candles and aggregate trades use /market.

Kraken L2 uses the 25-level WebSocket v2 book subscription. Price and quantity spellings are preserved before JSON float conversion so the official top-ten CRC32 matches. On a checksum mismatch, the local state is destroyed and the socket reconnects.

Coinbase book initialization consumes a public `level2_batch` snapshot and then applies absolute-size changes on the same ordered socket. The browser retains up to 1,000 nearest levels per side. Trade messages extend the current OHLCV bar, with `heartbeat.last_trade_id` compared against observed match IDs to request a REST refresh after persistent gaps. Coinbase does not offer an L2 CRC32 equivalent.

All book feeds drive the 10-by-10 bid/ask ladder and a sampled heatmap. Near-mid liquidity is binned at about one-second intervals into at most 200 bands and 160 time columns.

The chart consumes normalized UTC millisecond OHLCV and uses the same coordinate transform for candles, indicators, cursor and persisted line drawings. It triggers older-history callbacks when viewport navigation approaches the earliest stored candle. Binance uses an oldest-exclusive REST endTime cursor, while Coinbase requests bounded time ranges. Inserting older bars at the front preserves x positions of already visible candles. Up to 8,000 candles are retained in browser memory, and session generation guards prevent stale historical fetches from changing a newly selected market. One active market session owns its REST controller and sockets. Market switching closes prior feeds and blocks stale updates.

A future backend is justified for historical L2 retention, replay or multi-venue aggregation. At present all market access is public, read-only and direct from the browser, with no credentials or account state.

Unit tests cover numerical transforms, parsing, order-book snapshot overlap, sequence gaps, Kraken official CRC32 sample, Coinbase snapshot/update and heartbeat gap handling, candle upserts, depth binning, paged REST cursors, viewport preservation, and cancellation races. The offline browser smoke is distinct from a live endpoint probe, where regional HTTP errors are recorded.
