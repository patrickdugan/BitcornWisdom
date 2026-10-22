# v0.8 feature matrix

| Feature | Implementation | Follow-up |
| --- | --- | --- |
| Candles, volume, pan/zoom | Canvas2D chart | 100k-bar benchmarks |
| Themes | Noir, Afterhours, Verdigris with matching Canvas palettes | Theme export/import |
| Market navigation | Command deck, local favorites, discover shortcuts | Exchange-wide symbol discovery |
| Workspace panels | Collapsible watchlist and order-book; responsive drawer | Cross-pane drawing editor |
| Chart grid | Single, Split, Four; independent venue/symbol/interval + EMA/SMA/BB/RSI/LOG per secondary pane | Resizable grid and chart templates |
| Synced navigation | Optional linked time range and shared time cursor; venue-specific price scales | More precise session/time-gap alignment |
| Chart feeds | One full-depth primary; lightweight candles in secondary panes | Secondary L2 on demand |
| Chart export | Client-side PNG snapshot | Annotation layers and sharing |
| Bollinger 20/2σ | Price overlay plus basis | Configurable parameters |
| RSI 14 | Independent oscillator strip under volume | More studies |
| Older chart candles | Cursor-paged Binance/Coinbase REST, up to 8,000 bars | Kraken venue-side limit; gap handling |
| EMA/SMA, log scale | Yes | Further overlays |
| RSI | Library calculation | RSI subplot |
| Drawings | Editable trend lines, horizontal/vertical levels, Fibonacci 0–100%, local persistence, undo | Crosshair sync and geometry smoothing |
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
