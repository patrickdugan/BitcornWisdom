# Market motion and renderer measurement

BitcornWisdom v0.10 uses browser-native Canvas2D and draw-on-demand requestAnimationFrame. On an active candle or verified L2 update, its latest snapshot becomes authoritative immediately. For up to 180 ms, the renderer eases the visible candle body, wick, volume, or cumulative depth profile toward that snapshot. Trade ticks also move the current price marker and briefly highlight its new position. Numbers printed in the chart marker, header, order-book ladder and tape are **raw latest exchange observations**, so the brief graphic tween cannot be misread as a fabricated trade.

The market render meter measures **update arrival to the completion of Canvas draw**, not OS compositor presentation or exchange-wire latency. Its p95 spans a bounded rolling sample of 90 observed updates or draws; FPS excludes idle gaps and describes only active animation frames. The browser user interface shows these diagnostics and intentionally makes no universal FPS or latency promises.

## Data integrity and load

- The Binance book enters the renderer after sequenced REST-snapshot reconciliation; Kraken verifies CRC; Coinbase applies its snapshot-fed L2 updates. A reconnect or book-sync failure clears the depth rail.
- Cumulative bid and ask curves sample up to 1,000 verified levels per side and project onto the chart's current price-axis mapping, including log-scale. Small cumulative amounts receive square-root visual scaling, clearly a display-only transform.
- The independent L2 rail appears at chart widths of at least 700 CSS pixels. Narrow viewports preserve candle space.
- The classic desk's book list updates existing DOM row nodes and uses CSS width transitions. Motion Off and `prefers-reduced-motion:reduce` suppress DOM and Canvas transitions.
- Stored liquidity heatmap recordings still use sampled, price-binned observations, approximately one per second, and do not imply a lossless L2 history.
- Four-chart grid cells continue using their independent candle streams. Each may animate its latest candle, while only the classic desk holds a book subscription and L2 rail.

## Verification

`npm run check` validates interpolation math, depth sums, data invariants, render metrics, market adapters and original navigation tests. `npm run smoke:motion` launches real headless Chrome in offline demo mode and asserts painted green/red depth pixels, preserved book nodes across ticks, a running render meter, and the preference toggle. The command writes `bitcorn-market-motion.png`, uploaded in CI.

The smoke latency ceilings are generous, intended to detect broken rendering or severe stalls, rather than to certify a desktop-FPS SLA. Real-world benchmarking still needs sustained session measurements, source timestamp comparisons, CPU profiling, background-tab behavior, and GPU/HiDPI checks. Chart initial history is venue-limited and older Binance/Coinbase paging remains bounded to 8,000 retained bars.
