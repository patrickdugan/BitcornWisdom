# BitcornWisdom: the open market desk

The goal is a fast, understandable, self-hostable crypto charting workspace with independently rendered market data. BitcornWisdom currently uses Canvas2D, native JavaScript, and direct public exchange feeds.

## What v0.7 supports today

The three-pane desktop shows local favorite-market shortcuts, an interactive chart, and live order-book/liquidity tools. The command deck provides keyboard market search, theme controls, indicator toggles, panel navigation and chart export. Three dark color themes change the browser UI and the Canvas palette.

Indicators currently include EMA20, SMA50, Bollinger Bands 20 / 2σ, and a separate RSI14 pane. The chart supports a crosshair, volume, an editable drawing toolkit with trend lines, horizontal price levels, vertical time markers, Fibonacci retracements, and linear/log scaling. Annotation selection, endpoint movement, Shift-to-OHLC snapping and local undo history are supported.

Binance Spot/Futures, Kraken Spot and Coinbase Exchange feed one common OHLCV chart model. Order-book integrity varies by venue. The heatmap can replay bounded price-binned observations captured earlier on the same browser.

## What remains missing for broader TradingView parity

This is a working crypto-first alternative. A general-purpose stocks/forex workspace, multi-chart tabs and grid layouts, an alert infrastructure, a complete TradingView-style drawing library, and a Pine-compatible scripting engine are not currently implemented.

Inactive watchlist entries are market shortcuts. The application only subscribes to the active instrument.

## Product direction

Chart productivity: editable indicator parameters, more oscillator panels, additional drawing primitives and anchors, zoom presets, better historical timestamp mapping, and crosshair synchronization.

Workspace portability: saved multi-chart layouts and import/export of settings, with optional device synchronization.

Market coverage: Bitfinex and Bybit adapters, discovery of exchange symbols, stronger L2 reconnect diagnostics and explicit contract units.

Research tools: raw depth-event capture with provenance and sequence-gap recording, precise replay, and configurable local alerts.

Open extensions: a documented, read-only indicator API in isolated workers. Script execution, trading or wallet signing would require separate security design and permissions.

## Design constraints

Price action should own the largest surface. A clear chart and readable market structure take precedence over trading social feeds. Themes maintain distinguishable buy/sell colors. Navigation stays accessible by keyboard and user data lives locally by default.

The chart core currently culls offscreen candles and caches indicators between OHLCV changes. Future renderer work should measure 1k, 10k and 100k bars before introducing WebGL.

The MIT source and contribution process are documented in LICENSE and CONTRIBUTING.md.
