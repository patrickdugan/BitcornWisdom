# Network model, reviewed October 22, 2026

## Binance Spot

Candles: https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=1000
Depth REST: https://data-api.binance.vision/api/v3/depth?symbol=BTCUSDT&limit=1000
Combined candle/trade WS: wss://data-stream.binance.vision/stream?streams=btcusdt@kline_5m/btcusdt@trade
Depth WS: wss://data-stream.binance.vision/ws/btcusdt@depth@100ms

Buffer depth events, retrieve REST snapshot, and bridge snapshot lastUpdateId against U/u. Stop publishing the book when update sequence continuity fails.

Binance historic candles can request older pages using endTime = earliest_loaded_bar_open_ms - 1. Each request is capped at 1,000 bars. Empty pages end pagination.

Source: https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md

## Binance USDⓈ-M

Candles: https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=5m&limit=1000
Depth REST: https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=1000
Market WS: wss://fstream.binance.com/market/stream?streams=btcusdt@kline_5m/btcusdt@aggTrade
Depth WS: wss://fstream.binance.com/public/ws/btcusdt@depth@100ms

Futures event pu must match the previous event's final ID u after the first snapshot-overlapping event. The futures /public and /market separation was introduced in 2026; legacy unrouted endpoints were retired in April 2026.

Source: https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Connect

## Kraken Spot

REST OHLC: https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=5
Market WS v2: wss://ws.kraken.com/v2

Subscribe to ohlc, trade and book (depth 25) for BTC/USD. The REST OHLC array contains epoch seconds, OHLC, VWAP, volume and trade count, up to 720 recent entries. Kraken v2 book sends a CRC32 of top-ten ask/bid levels with each snapshot/update. The application keeps exact decimal spellings in its CRC calculation and reconnects after mismatches.

Official docs:
- https://docs.kraken.com/api/docs/rest-api/get-ohlc-data/
- https://docs.kraken.com/api/docs/websocket-v2/ohlc/
- https://docs.kraken.com/api/docs/websocket-v2/trade/
- https://docs.kraken.com/api/docs/websocket-v2/book/
- https://docs.kraken.com/api/docs/guides/spot-ws-book-v2/

## Coinbase Exchange Spot

REST candles: https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=300

Public WebSocket: wss://ws-feed.exchange.coinbase.com

Subscribe to level2_batch, matches and heartbeat for BTC-USD. The Exchange REST candle format is [Unix seconds, low, high, open, close, base volume], in reverse chronological order with up to 300 bars per request. Supported intervals: 60, 300, 900, 3600, 21600 and 86400 seconds.

Coinbase older-candle requests include an explicit start/end ISO 8601 range, bounded to 299 interval spans to remain within its documented 300-candle limit. Empty pages end pagination.

The unauthenticated level2_batch feed sends a book snapshot followed by ordered, absolute-quantity l2update messages. The consumer bounds storage to 1,000 known levels and resubscribes on reconnect. The matches channel gives per-trade price, size and maker side; maker side is inverted for the taker-aggressor tape. Because matches messages may be dropped, heartbeat last_trade_id monitors progress, with a grace interval and cooldown before refreshing REST history. Restored OHLCV can still have data gaps; no archival replay service exists.

Sources:
- https://docs.cdp.coinbase.com/exchange/websocket-feed/overview
- https://docs.cdp.coinbase.com/exchange/websocket-feed/channels
- https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles

## Endpoint probe

On October 22, 2026, GitHub Actions reported eight successful public endpoints: Binance Spot REST candles/WS trades, Binance Futures WS aggTrade/diff-depth, Kraken REST OHLC and a CRC-valid Kraken book, plus Coinbase REST candles and a Level 2 WebSocket snapshot. Binance Futures REST responded HTTP 451 from the runner. These observations describe that network only and do not guarantee browser reachability. The raw report is an optional CI artifact.


## Locally recorded depth, version 0.5

BitcornWisdom records one price-binned column from whichever validated order-book adapter is active. Samples include local observed-at time, optional exchange event time, source type and sparse depth within ±1% of the price. The browser IndexedDB archive is independent of the REST candle history and WebSocket market message formats above. It restores only data previously observed by this browser while the chart was active.

Full raw L2 event replay and reconstruction across periods when the browser is closed require a separate, persistent collector; this client does not claim such coverage. See LIQUIDITY_REPLAY.md for sample format, retention, gap rendering and replay controls.
