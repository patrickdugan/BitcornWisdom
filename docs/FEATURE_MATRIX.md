# v0.5 feature matrix

| Feature | Implementation | Follow-up |
| --- | --- | --- |
| Candles, volume, pan/zoom | Canvas2D chart | 100k-bar benchmarks |
| Older chart candles | Cursor-paged Binance/Coinbase REST, up to 8,000 bars | Kraken venue-side limit; gap handling |
| EMA/SMA, log scale | Yes | Further overlays |
| RSI | Library calculation | RSI subplot |
| Trend lines | Local persistence | Editing/Fibonacci |
| Binance Spot | Candles, raw trades, synchronized bounded L2 | Deep historical replay |
| Binance Futures | Candles, aggTrade, U/u/pu synchronized L2 | Futures REST region checks |
| Kraken Spot | REST/WS v2 candles, trade, CRC32-verified L2 | Larger book depth |
| Coinbase Exchange Spot | REST OHLC, trade-extended live bars, bounded L2 snapshot/update and heartbeat gap detection | Full L2 replay |
| Heatmap | Live ±1% band, 200 bins, 160 visible samples | Durable raw depth |
| Sampled history | IndexedDB, 6k replay samples loaded, ~12k global storage cap | Browser eviction and export |
| Replay | Seek/play/pause/speed, per-market stored columns, gap markers | Full event-level replay |
| Other venues | Planned | Bitfinex, Bybit |
| Alerts, trading, social | Out of scope for core | Optional separate services |
| TradingView dependency | None | Maintain |

BitcornWisdom is an independent behavioral rebuild with zero runtime dependencies.
