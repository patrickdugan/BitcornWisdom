# Network model and provenance

## Binance Spot

REST history: https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=1000

Fallback REST: https://api.binance.com/api/v3/klines

Combined market stream: wss://data-stream.binance.vision/stream?streams=btcusdt@kline_5m/btcusdt@trade/btcusdt@depth20@100ms

The public combined stream wraps messages with stream and data properties. Kline events supply t/o/h/l/c/v; trade events supply T/p/q/m; partial depth packets supply bids/asks and a lastUpdateId.

## Binance USDⓈ-M

REST history: https://fapi.binance.com/fapi/v1/klines

Market stream: wss://fstream.binance.com/market/stream?streams=...

History and live frames normalize into the same app model. Futures and spot remain separate instruments.

Network behavior: abort canceled fetches, ignore stale session callbacks, reconnect with exponential backoff capped around 30 seconds. No keys or signed calls. Geographic restrictions can prevent live access.

References: [Spot stream documentation](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md), [public data hosts](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md), [Binance Futures API docs](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Kline-Candlestick-Data).

## BitcoinWisdom archaeology

Historical third-party adapter: https://github.com/garethdmm/gryphon/blob/73e19fa2d0b64c3fc7dac9e0036fc92e25e5b694/gryphon/lib/bitcoinwisdom.py describes an old candle endpoint at s5.bitcoinwisdom.com/period, with step and symbol query parameters.

**Evidence labels:** the Binance endpoint formats are DOCUMENTED public interfaces; the historical client source is VERIFIED as published third-party code; current live BitcoinWisdom proprietary network schema is NOT YET CAPTURED. No claim of protocol compatibility is made.
