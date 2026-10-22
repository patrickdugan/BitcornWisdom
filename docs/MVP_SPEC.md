# Build milestones

## Implemented first slice

OHLCV chart, keyboard/mouse pan and zoom, crosshair, UTC axes, linear/log scale, EMA20, SMA50, volume, locally persisted trend lines, Binance Spot/Futures public history and streams, top-20 partial depth, trade tape, rolling partial-book heatmap, offline sample mode, zero external JS dependencies, unit tests, CI.

The first slice still needs cross-browser UI and exchange-connectivity verification.

## Next

1. Browser screenshot and interaction tests, plus measured Canvas2D performance.
2. Historical candle paging beyond the current 1,000-bar fetch.
3. Snapshot-plus-delta order-book synchronization with sequence-gap recovery.
4. Cross-browser precision checks for index/time/price transforms.
5. Coinbase, Kraken, Bybit and Bitfinex adapter contract tests.
6. RSI chart pane, MACD, Bollinger Bands, SAR and further oscillators.
7. Drawings selection/editing, horizontal/vertical lines, exports, saved layouts.

## Later

Cross-exchange price/quote normalization; full-depth and aggregated historical heatmaps; alerts with explicit security controls; browser vs WebGL measured comparison at 1,000, 10,000 and 100,000 bars.

Keep broker accounts, Pine Script, social plugins and TradingView dependencies outside the core.
