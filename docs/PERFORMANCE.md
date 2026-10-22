# Renderer measurement plan

No measured browser FPS or per-frame latency numbers are claimed yet. Unit tests cover coordinate transforms, including invertibility under zoom and pan. The current client begins with venue-limited candle history and lazily paginates Binance/Coinbase older bars up to 8,000 retained candles.

Benchmark Chromium and Firefox at 1,000, 10,000 and 100,000 synthetic bars. Fix viewport to 1200×700, then compare first draw, drag/zoom FPS, main-thread long tasks, memory, and devicePixelRatio 1x versus 2x. Record performance before choosing WebGL.

Canvas currently renders only visible candles based on width/barWidth. Since v0.6, EMA/SMA, Bollinger and RSI arrays are cached across pan, hover, and zoom redraws, then invalidated when OHLCV changes. Indicator recalculation still scales with loaded bar count and needs timing measurements before raising the 8k chart cap. Handle missing trading periods and optimize live indicator caching before interpreting any 100k-bar benchmark as a production-capable history test.


## Multi-chart resource budget

Version 0.8 supports up to four independent Canvas instances; each retains at most 8,000 loaded candles. Secondary panes use public candle streams rather than launching additional full-depth book sync or liquidity collectors. Hiding a pane closes its associated socket and timers and tears down its Canvas observer. Expect higher CPU, GPU raster, network and memory use with four charts than with one; these effects have not been benchmarked in a controlled 100k-bar test. The synchronization callbacks only update destination view positions without triggering a recursive broadcast.

Measure sustained four-chart frame rates and heap size across mixed timeframes in Chrome and Firefox before raising the local candle cap or adding secondary depth feeds. Live snapshots shown by CI are functional integration evidence, not FPS benchmarks.

## IndexedDB replay budget

The liquidity archive retains at most about 12,000 timestamped sparse columns globally, loads 6,000 of the selected series, and draws a maximum of 160 at any point. One capture approximately every second adds a bounded IndexedDB write. Live capture appends in constant time when sample clocks increase, while bulk history restoration sorts and deduplicates the loaded columns. Pruning runs periodically and on startup.

Measure real data-recording throughput and quota behavior separately from the screenshot smoke. Monitor browser heap growth and IndexedDB size after sustained use on deep Binance books. Archived binned columns omit fine-grained depth events and should not be interpreted as high-frequency exchange fidelity.
