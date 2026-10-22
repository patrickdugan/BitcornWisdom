# ₿ BitcornWisdom

**Your market. Your desk.** An independent, open-source crypto charting terminal built for people who want a fast workspace they can inspect, modify and run themselves.

[![Checks](https://github.com/patrickdugan/BitcornWisdom/actions/workflows/check.yml/badge.svg)](https://github.com/patrickdugan/BitcornWisdom/actions/workflows/check.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-d9b782.svg)](LICENSE)

Inspired by the feel of the original BitcoinWisdom charts. Built with a homegrown Canvas2D renderer, native browser JavaScript, and **zero npm dependencies**. No TradingView widget, Lightweight Charts package, Pine Script, broker login, or API key.

## The open-market desk (v0.8)

The latest workspace adds **Single, Split and Four-chart layouts** inside the three-panel market desk, with customizable color themes and quick access to favorite markets. The secondary charts can each track a different exchange, symbol, timeframe and indicator set.

| Charting | Desk and navigation | Liquidity and data |
| --- | --- | --- |
| Candles with BTC-friendly zoom and pan | Fast market search / command deck (Ctrl+K) | Binance Spot and USDⓈ-M Futures |
| Volume, EMA 20, SMA 50 | Local favorites and watchlist | Kraken Spot and Coinbase Exchange |
| Bollinger Bands 20 / 2σ, RSI 14 pane | Market presets, keyboard-first shortcuts | Live trade tape and bounded L2 book |
| Linear / logarithmic price axis | Noir, Afterhours, Verdigris themes | Kraken CRC32 and Binance sequence checks |
| Crosshair, editable trend/price/time/Fibonacci annotations | Collapsible market and order-book panels | Binned liquidity heatmap with local replay |
| PNG chart export | Direct URL-addressable pairs and intervals | IndexedDB sample retention and replay |
| **1 / 2 / 4 simultaneous charts** | **Linked time span and crosshairs** | Lightweight secondary candle feeds |

### Run it in one command

Node 20+ is required. No install step or build tooling.

    git clone https://github.com/patrickdugan/BitcornWisdom.git
    cd BitcornWisdom
    npm start

Open http://127.0.0.1:5173/ for public market feeds. Open http://127.0.0.1:5173/?demo=1 for the **offline synthetic market** used by the screenshots and tests.

    npm run check          # syntax checks and deterministic unit tests
    npm run smoke          # headless Chrome demo hydration
    npm run smoke:archive  # IndexedDB, replay, workspace UI and drawing interactions
    npm run smoke:grid     # four independent charts, linking and saved layouts
    npm run probe:live     # optional public exchange reachability
    npm run browser:live   # optional live Chrome integration

Static hosting also works: index.html uses relative asset paths, so the site can be served from a subdirectory with HTTPS. See [hosting guidance](docs/HOSTING.md) for local and static setups, browser permissions and exchange restrictions.

### Multi-chart workspace

Select Single, Split, or Four from the LAYOUT menu. In each secondary pane, choose an exchange, symbol and timeframe; the chart loads its own candles and updates without changing the main chart. EMA/SMA/Bollinger/RSI/logarithmic settings are independent. The **Time** switch links pan/zoom across charts by absolute timestamp and approximate visible time range; **Cursor** links the crosshair time. Both can be disabled and are saved along with your pane settings.

The primary chart continues to drive the right-hand live order book, liquidity recording and trade tape. Secondary panes use lightweight OHLC/trade streams rather than duplicating full-depth books. Layout changes stop and release data feeds for removed panes.

See [the multi-chart guide](docs/MULTI_CHART.md) for workflow, data-feed limits, persistence and synchronized-navigation semantics.

### The keyboard workflow

| Key | Action |
| --- | --- |
| Ctrl+K / Cmd+K | Search markets and commands |
| / | Open the command deck |
| W | Show/hide watchlist |
| B | Show/hide order-book and liquidity panel |
| Left / Right arrows (with chart focused) | Pan |
| Up / Down arrows (with chart focused) | Zoom |
| Mouse wheel over chart | Zoom at cursor |
| Home (with chart focused) | Reset chart view |
| Ctrl+Z / Cmd+Z (with chart focused) | Undo the last drawing addition, movement or deletion |
| Delete / Backspace (with chart focused) | Remove selected annotation |
| D / L / H / V / F | Select / trend / horizontal / vertical / Fibonacci drawing tool |
| Escape | Cancel pending drawing / dismiss command deck |

Commands include market jumps, 1m–1d timeframe changes, indicators, palette selection, starring markets, workspace panels, and chart export. You can still type arbitrary supported exchange symbols into the top market form. A watchlist shortcut opens the selected market; inactive favorites do not maintain background price subscriptions.

Theme, favorite markets, chart indicators, **chart-grid layout and per-pane market selections**, layout preferences and market/timeframe drawings persist locally. The primary drawing toolbar adds a selection tool for moving annotations, horizontal price levels, vertical time markers and Fibonacci retracements. Hold **Shift** near a candle's OHLC to snap an anchor to that price. Undo also restores edits and deletions. See [Drawing tools](docs/DRAWINGS.md). You can run the terminal without accounts or cookies.

## Market feeds and limits

| Venue | History | Current book | Live trades |
| --- | --- | --- | --- |
| Binance Spot | Kline REST, with older-page loading | Up to 1,000 levels per side, buffered snapshot + diff sequence | Spot raw trades |
| Binance USDⓈ-M | Kline REST, with older-page loading | Up to 1,000 levels per side, U/u/pu continuity | Futures aggTrade |
| Kraken Spot | Venue's latest 720 OHLC bars | 25 levels per side, CRC32-verified top ten | Kraken WS v2 trades |
| Coinbase Exchange | 300 bars per REST page, with older-page loading | Snapshot-fed Level 2, max 1,000 retained levels/side | Public matches + heartbeat gap checks |

The chart can retain up to 8,000 candles from paged sources. Browser/API geo restrictions remain possible. CI previously observed HTTP 451 from Binance Futures REST on its runner, while public Spot and Kraken/Coinbase integration checks passed.

The liquidity recorder saves **sampled and price-binned L2 observations captured while your browser is open**. IndexedDB retains up to around 12,000 records across markets, with a 24-hour age limit; replay loads up to 6,000 samples and displays a maximum of 160 at once. This is a local observation history, **not** a lossless market-wide historical depth feed. See [the recorder design](docs/LIQUIDITY_REPLAY.md).

## Architecture

    Exchange REST + public WS
               |
        Native adapters
       (Binance / Kraken / Coinbase)
               |
        Normalized OHLCV / L2
               |
       +-------+-------------------+
       |                           |
    Canvas2D engine          IndexedDB archive
    + indicators             + replay timeline
       |
    Keyboard-first market desk

The core remains browser-native JavaScript, with a small Node static server for local development. No analytics SDK or remote account service is required.

## What we're building toward

BitcornWisdom is a **crypto-first TradingView alternative in progress**. Current features cover independent multi-chart layouts, synchronized time navigation, technical analysis, editable primary-chart annotations and market microstructure. Planned work includes shared drawing toolbars across panes, configurable studies, portable workspace exports, alerts, additional venues, and optional open plugin interfaces.

See [multi-chart guide](docs/MULTI_CHART.md), [product direction](docs/PRODUCT.md), [feature matrix](docs/FEATURE_MATRIX.md) and [architecture](docs/ARCHITECTURE.md). For contributors, start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License and independence

[MIT licensed](LICENSE), © 2026 Patrick Dugan. BitcornWisdom is unaffiliated with TradingView, BitcoinWisdom.com or BitcoinWisdom.io.

The [Grossman BitcoinWisdom reconstruction](https://github.com/grossman8/bitcoin-wisdom-chart) (MIT) was studied as a behavior reference; its source was not copied. Exchange market data is subject to each venue's public API terms, rates and geographic availability. See [Third-party notices](THIRD_PARTY_NOTICES.md).
