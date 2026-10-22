# Multi-chart desk (v0.8)

BitcornWisdom provides a separate, static `grid.html` workspace. The original chart-and-order-book desk remains intact on `index.html`.

## How to use

Open `grid.html?demo=1` for the synthetic offline market. Set the layout to 1, 2 or 4 charts. In each cell select an exchange, symbol and timeframe. Press GO or Enter. Layout selections are stored locally under `bitcornwisdom:grid:v1` and restored when reopening this browser origin.

You can deep-link to layouts using `grid.html?demo=1&mode=4`. Query overrides change the displayed mode for that opening.

**Sync crosshair** broadcasts the hovered candle's timestamp to the other visible charts. Each chart renders a vertical guide at the matching time. For this initial release crosshair synchronization uses timestamps from nearest candles rather than a continuous calendar x-axis. When switching exchanges or timeframes, exact visual alignment can be approximate.

**Sync zoom/pan** sends the leading chart's bar width and distance from its latest bar to the others. It is best suited to charts at identical intervals. It is not equivalent to synchronized absolute UTC time ranges when intervals differ.

## Architecture

Each chart cell owns its own `CandleChart`, abortable history request, reconnecting market WebSocket and demo timer. A per-cell generation number rejects stale asynchronous responses after an exchange or interval switch. Hidden cells are destroyed when switching from four to two or one charts, closing their sockets and canceling their timers. The 1/2/4 layouts share no OHLCV arrays.

Binance spot/futures, Kraken and Coinbase share the same per-cell API selection, with venue-specific interval allowlists. The grid omits the Level 2 book and liquidity recorder from each cell to avoid opening four full-depth book subscriptions. Those remain available in the classic desk.

The renderer reuses all existing indicators and navigation controls; the grid's overlay theme applies to every cell. Grid layout persistence is separate from the classic desk's settings and the chart drawing localStorage keys.

## Limits

- 1, 2 or 4 visible charts, not arbitrary resizable panels.
- Only active visible cells open public market sockets. Multiple subscriptions may be subject to exchange limits.
- 8,000-bar cap in the renderer, but grid cells currently fetch only the exchange's initial recent REST page. The full historical paging UX remains in the classic desk.
- Grid canvases are for inspection, without independent L2 ladders, local drawing toolbars or saved multi-layout collections in v0.8.
- This is a static client; closing the page stops all live feeds, and geographic restrictions on exchange APIs still apply.

## Verification

The `npm run smoke:grid` test opens the real grid page in Chrome using synthetic data and checks 1, 2 and 4-chart layouts, price labels, feed status and screenshots. The `test/grid.test.mjs` suite covers model normalization, market interval restrictions and serialization. The classic desk's full Chrome and live market tests remain in CI.
