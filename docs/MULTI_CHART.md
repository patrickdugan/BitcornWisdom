# Multi-chart workspace (v0.8)

BitcornWisdom can show one, two, or four independent Canvas2D charts at once, without TradingView libraries or extra runtime dependencies.

## Using the grid

Choose a layout in the chart toolbar:

- **Single** — the original primary chart fills the workspace.
- **Split** — the primary chart plus one independent secondary chart.
- **Four** — a 2×2 layout: primary plus three independent charts.

Every secondary chart includes an exchange selector, symbol field, timeframe, and independent **EMA, SMA, BB, RSI, LOG** controls. Press ↗ (or Enter) after editing the symbol. Exchanges and intervals are validated against existing Binance Spot, Binance Futures, Kraken and Coinbase adapters. Changes to one pane do not change the other panes or the main market watchlist.

All secondary chart preferences, active layout, and link switches are persisted in the existing local settings key. Restoring a browser session recreates the same number of charts and requested symbols/timeframes. Collapsing the layout closes the sockets, timers and observers belonging to removed panes; returning to a larger layout restarts them.

The command palette (Ctrl+K) also offers One chart, Two charts, Four charts, and toggles for linked time and linked crosshair.

## Navigation synchronization

The **Time** checkbox synchronizes horizontal navigation: pan or zoom in any pane, and the others follow its center timestamp and approximate visible time span. A 1-minute series and a 1-hour series therefore occupy different numbers of candles while covering the same time range, where both venues have history. Bar widths are bounded for readability. Switching Time off preserves independent navigation.

The **Cursor** checkbox synchronizes the crosshair's **time** coordinate, not the Y-axis price, since simultaneous panes may show different assets and quote units. The linked cursor is cleared when the pointer leaves its originating pane. Both switches can be changed independently and are saved locally.

The chart geometry uses Unix-millisecond timestamps, including interpolation across gaps in sparse candle series. The visual time span is approximate at very wide/very narrow zoom levels, and longer history is constrained by the API and local cache of each pane.

## Feeds and performance boundaries

The **primary chart** continues to own the live trade tape, verified order book, and sampled liquidity recording sidebar. Secondary panes subscribe only to their own needed candle feeds:

- Binance Spot and Futures: a read-only public kline/trade connection with the existing adapter.
- Kraken: a lightweight public WebSocket v2 **OHLC-only** subscription.
- Coinbase Exchange: lightweight public **matches + heartbeat** subscriptions, with candle history refresh after suspected gaps.

Each pane has its own abortable REST fetch, chart instance, historical paging where supported, draw-state namespace, and reconnecting WebSocket. Secondary panes do not create duplicate full-depth order-book streams. The UI avoids a hidden background data subscription to markets not shown.

At most four charts can be active. Each uses the existing bounded local candle cache (up to 8,000 bars), so peak chart memory/CPU will be greater than single mode; the renderer still culls offscreen candles and caches indicators between OHLCV changes. Secondary chart selectors can still encounter geographic restrictions or exchange-specific unavailable symbols, and show a retryable error in their own pane.

The demo mode is explicitly synthetic. Its secondary panes use independently scaled mock BTC/ETH/SOL markets to exercise layouts without exchange connectivity. On return to live mode, secondary demo timers are stopped and public streams are created again.

## Important scope distinctions

Only the primary chart currently drives the right-hand L2 book, liquidity timeline, trade tape, and top-level symbol/watchlist. The top-level drawing toolbar and PNG export also operate on the primary chart. Secondary charts render with their own indicator settings and can store their own drawing geometry through the chart component, but a dedicated secondary drawing toolbar and simultaneous full-depth L2 recording are not in this release.

This is a crypto-first multi-chart workspace, not a general stocks/forex data service or a broker/trading platform. No API credentials, wallet connections, hosted accounts or TradingView code are involved.

## Tests

Run:

    npm run check
    npm run smoke
    npm run smoke:grid
    npm run smoke:archive

The grid smoke starts a temporary Chrome profile in offline demo, opens four charts, changes chart #2 to a different venue/timeframe, toggles its BB study, verifies independent indicators, linked time navigation and linked crosshair, collapses to two and one charts, then reloads to verify saved preferences. The screenshot is attached to CI as bitcorn-multi-chart.png.

The optional npm run browser:live probe also opens a four-chart live grid and records the observed status of simultaneous public exchange feeds, subject to the runner's networking and regional access. Browser network diagnostics remain advisory and do not define deterministic CI success.
