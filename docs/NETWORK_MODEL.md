# Network model, reviewed October 22, 2026

## Binance Spot

Candles: https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=1000
Depth REST: https://data-api.binance.vision/api/v3/depth?symbol=BTCUSDT&limit=1000
Combined candle/trade WS: wss://data-stream.binance.vision/stream?streams=btcusdt@kline_5m/btcusdt@trade
Depth WS: wss://data-stream.binance.vision/ws/btcusdt@depth@100ms

Buffer depth events, retrieve REST snapshot, and bridge snapshot lastUpdateId against U/u. Stop publishing the book when update sequence continuity fails.

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

## Endpoint probe

On October 22, 2026, GitHub Actions reported six successful public endpoints: Binance Spot REST candles/WS trades, Binance Futures WS aggTrade/diff-depth, Kraken REST OHLC, and a CRC-valid Kraken WebSocket book. Binance Futures REST responded HTTP 451 from the runner. These observations describe that network only and do not guarantee browser reachability. The raw report is an optional CI artifact.
