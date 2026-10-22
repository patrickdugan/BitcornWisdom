# Next milestones

Delivered by v0.5: standalone Canvas2D terminal; market/timeframe controls; persisted trend lines; Binance Spot and USDⓈ-M candle/trade adapters; U/u/pu synchronized 1,000-level bounded Binance order books; Kraken spot OHLC, trades and CRC32-verified 25-level book; Coinbase Exchange candles, trade tape, heartbeat gap detection and bounded snapshot-fed L2; Binance/Coinbase older-candle pagination to an 8k local cap; bin-limited heatmap; persisted and replayable IndexedDB sampled depth with retention, archive separation and erase; offline demo; tests; live network probe.

Next engineering tasks:

1. Real-browser end-to-end test of Binance Spot and Kraken from multiple regions.
2. Soak test of L2 synchronization and automated recovery, tracking reset rates and latency.
3. Bitfinex and Bybit public market adapters.
4. Robust historical candle time-gap handling and incremental indicator caching.
5. Log and linear renderer benchmarking at 1k, 10k, 100k candles.
6. RSI, MACD, Bollinger indicators; editable drawing geometry.

Later: lossless historical raw L2 recording and event replay, portable export/import, and cross-venue aggregation. The current IndexedDB history stores the bins this browser observed while the chart was open.
