# ₿ BitcornWisdom

**Your market. Your desk.** An independent, open-source crypto charting terminal built for people who want a fast workspace they can inspect, modify and run themselves.

[![Checks](https://github.com/patrickdugan/BitcornWisdom/actions/workflows/check.yml/badge.svg)](https://github.com/patrickdugan/BitcornWisdom/actions/workflows/check.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-d9b782.svg)](LICENSE)

Inspired by the feel of the original BitcoinWisdom charts. Built with a homegrown Canvas2D renderer, native browser JavaScript, and **zero npm dependencies**. No TradingView widget, Lightweight Charts package, Pine Script, broker login, or API key.

**Live market motion (v0.10).** The classic desk now paints an animated cumulative bid/ask depth profile next to the price scale, a trade-responsive market marker, and short transitions on the current candle. Order-book quantity bars animate in place and fresh trades enter with a subtle flash. The `Motion` button controls visual transitions; operating-system reduced-motion settings disable them. A small footer readout shows observed Canvas draw p95, update-to-draw p95, and active frame rate from the local browser. Raw exchange candles, confirmed book snapshots and trade records always remain authoritative. The depth profile depends on the available L2 levels and the chart's visible price range. This renderer interpolates visuals for a fraction of a second; it never creates exchange observations.

## Hosted live preview

Once GitHub Pages is enabled, the expected URL for [Kraken BTC/USD 1m live](https://patrickdugan.github.io/BitcornWisdom/index.html?market=kraken&symbol=BTCUSD&interval=1m&demo=0) is hosted through the [Public live preview workflow](.github/workflows/pages.yml). See [Hosting](docs/HOSTING.md) for setup and validation.

## Embed SDK and federated feeds (v0.11)

The [standalone embedded chart](embed.html?demo=1) can be placed in other
websites and apps with a plain iframe or controlled through the
[zero-dependency JavaScript SDK](src/embed-sdk.js). The
[two-chart integration lab](embed-lab.html?demo=1) demonstrates live SDK
methods, responsive embeds and independent source events.

```html
<iframe src="https://patrickdugan.github.io/BitcornWisdom/embed.html?instrument=BTC-USD-SPOT&interval=1m"
        style="width:100%;height:420px;border:0" title="BTC/USD live chart"></iframe>
```

BTC/USD and ETH/USD spot embeds have eligible Kraken and Coinbase public
sources, with source-health monitoring, visible failover, and no cross-quote
or spot/perpetual substitution. Opt-in self-hosted HTTPS relays can implement
the simple OHLCV history and stream protocol. The embedded data router
publishes one source at a time and labels provenance. Full L2 book and
liquidity replay remain on the classic desk. [Embed and relay
documentation](docs/EMBED.md) includes SDK/React snippets, relay examples,
security boundaries and QA instructions.

### Third-party app QA and a self-hosted relay

The v0.11.1 integration pass adds real **cross-origin ESM/iframe tests** and
a [runnable, read-only Kraken relay](examples/relay-node.mjs). Unlike a mere
second CDN origin, the relay exposes typed OHLCV over its own HTTP/WebSocket
endpoints. It still inherits Kraken's upstream trust and availability.

```sh
npm run relay:kraken    # local HTTP + WebSocket on 127.0.0.1:8722
npm run smoke:cross-origin
```

Use `preferred=relay:1` alongside an opted-in `relay` URL to place your
own relay ahead of the compatible native sources. Each source remains
explicitly identified, and initial REST prices display `HISTORY` until a
real WebSocket candle arrives. See [Embed SDK](docs/EMBED.md).

## The open-market desk (v0.8)

The classic workspace has a three-panel terminal layout with customizable themes and a local watchlist. The new [multi-chart desk](grid.html) opens one, two, or four independent market charts simultaneously, with optional crosshair and pan/zoom synchronization.

| Charting | Desk and navigation | Liquidity and data |
| --- | --- | --- |
| Candles with BTC-friendly zoom and pan | Fast market search / command deck (Ctrl+K) | Binance Spot and USDⓈ-M Futures |
| Volume, EMA 20, SMA 50 | Local favorites and watchlist | Kraken Spot and Coinbase Exchange |
| Bollinger Bands 20 / 2σ, RSI 14 pane | Market presets, keyboard-first shortcuts | Live trade tape and bounded L2 book |
| Linear / logarithmic price axis | Noir, Afterhours, Verdigris themes | Kraken CRC32 and Binance sequence checks |
| Crosshair, editable trend/price/time/Fibonacci annotations | Collapsible market and order-book panels | Binned liquidity heatmap with local replay |
| PNG chart export | Direct URL-addressable pairs and intervals | IndexedDB sample retention and replay |

### Run it in one command

Node 20+ is required. No install step or build tooling.

    git clone https://github.com/patrickdugan/BitcornWisdom.git
    cd BitcornWisdom
    npm start

Open http://127.0.0.1:5173/ for public market feeds. Open http://127.0.0.1:5173/?demo=1 for the **offline synthetic market** used by the screenshots and tests.

    npm run check          # syntax checks and deterministic unit tests
    npm run smoke          # headless Chrome demo hydration
    npm run smoke:grid     # 1/2/4 chart offline grid hydration
    npm run smoke:motion   # actual Chrome depth-pixel, rendering, motion preference and book-row test
    npm run smoke:embed    # two SDK iframes, postMessage guards and source identity
    npm run smoke:cross-origin # independent host origin loads and controls the SDK
    npm run smoke:archive  # IndexedDB, replay, workspace UI and drawing interactions
    npm run probe:live     # optional public exchange reachability
    npm run browser:live   # optional live Chrome integration

Static hosting also works: index.html uses relative asset paths, so the site can be served from a subdirectory with HTTPS. See [hosting guidance](docs/HOSTING.md) for local and static setups, browser permissions and exchange restrictions.

### Multi-chart grids

Open **http://127.0.0.1:5173/grid.html?demo=1&mode=4** to preview four charts offline, or remove `demo=1` for live public feeds. Each pane has its own venue, symbol, timeframe, candle chart, and WebSocket lifecycle. Switching layouts stops inactive chart subscriptions. Your layout choices persist in localStorage. Optional synchronized crosshairs mark the same candle timestamp across charts; synchronized zoom/pan projects the viewport across candle intervals using UTC timestamps. The classic single-chart workspace remains at `index.html`.

See [grid architecture](docs/MULTICHART.md) for guarantees and limits.

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

Theme, favorite markets, chart indicators, layout preferences and market/timeframe drawings persist locally. The drawing toolbar adds a selection tool for moving annotations, horizontal price levels, vertical time markers and Fibonacci retracements. Hold **Shift** near a candle's OHLC to snap an anchor to that price. Undo also restores edits and deletions. See [Drawing tools](docs/DRAWINGS.md). You can run the terminal without accounts or cookies.

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

BitcornWisdom is a **crypto-first TradingView alternative in progress**. Current features cover chart navigation, basic technical analysis, editable drawing annotations and market microstructure. Planned work includes a wider selection of embeds, study plugins, alerts, more venues, and independent data relays.

See [product direction](docs/PRODUCT.md), [feature matrix](docs/FEATURE_MATRIX.md) and [architecture](docs/ARCHITECTURE.md). For contributors, start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License and independence

[MIT licensed](LICENSE), © 2026 Patrick Dugan. BitcornWisdom is unaffiliated with TradingView, BitcoinWisdom.com or BitcoinWisdom.io.

The [Grossman BitcoinWisdom reconstruction](https://github.com/grossman8/bitcoin-wisdom-chart) (MIT) was studied as a behavior reference; its source was not copied. Exchange market data is subject to each venue's public API terms, rates and geographic availability. See [Third-party notices](THIRD_PARTY_NOTICES.md).
