# BitcornWisdom

An independent, MIT-licensed, BitcoinWisdom-inspired market terminal. It runs directly in modern browsers with **zero JavaScript dependencies**.

The first version includes OHLC candles, volume, EMA20/SMA50, log scale, mouse/keyboard navigation, crosshair inspection, saved trend lines, Binance Spot and USDⓈ-M public feeds, a trade tape, top-20 depth snapshots, and a rolling liquidity heatmap.

**Status:** first working slice. The offline demo is deterministic and independent of exchange access. Live Binance connectivity depends on the browser/network and still needs a hands-on check. This is read-only visualization software.

## Running it

Node 20 or later:

    git clone https://github.com/patrickdugan/BitcornWisdom.git
    cd BitcornWisdom
    npm start

Open http://127.0.0.1:5173/

For an instant offline chart, visit http://127.0.0.1:5173/?demo=1 or click **Use offline demo** in the footer.

To run checks:

    npm run check

No npm install is required. The local server uses only Node built-ins. The browser loads native ES modules.

## Controls

- Mouse wheel: zoom around pointer.
- Mouse drag: pan.
- Focus chart, then left/right arrows: pan; up/down arrows: zoom; Home: reset.
- Line button, then two chart clicks: add a trend line; Ctrl+Z or ↶: undo; Esc: cancel pending line.
- EMA 20, SMA 50, LOG toggles: indicators and scale.
- Market menu: Binance Spot or Binance USDⓈ-M. Enter BTCUSDT, ETHUSDT or another supported symbol, then Load.
- Timeframes: 1 minute to 1 week.

Markets, settings and per-market/timeframe drawings persist in localStorage. The demo is clearly labelled so synthetic data cannot be mistaken for a real price.

## Market data

| Feed | Source | Meaning |
| --- | --- | --- |
| Spot candles | Binance public market-data REST | 1,000 recent OHLCV bars |
| Spot realtime | Binance market-data WebSocket | kline, trade, partial book |
| USDⓈ-M history | Binance /fapi/v1/klines | 1,000 recent OHLCV bars |
| USDⓈ-M realtime | Binance futures market stream | kline, trade, partial book |
| Offline demo | Deterministic local generator | Sample-only, explicitly marked |

**Order-book precision:** the first version uses public, self-contained top-20 partial book snapshots, displaying the nearest 10 levels per side. The heatmap samples these at about one second and retains up to 160 columns. It starts from the moment the page opens. It is neither historical full-depth data nor an aggregated book. Correct full-depth replay requires a separate snapshot-plus-delta reconciliation design.

Binance may refuse connections based on region, IP, API permissions or browser network policies. The offline demo remains available in such situations. No API keys are accepted, no orders are sent, and no backend account exists.

## Code map

| File | Role |
| --- | --- |
| src/core.js | Normalized candles, trades, depth; validation |
| src/binance.js | Public REST and combined WS adapter |
| src/chart.js | Canvas2D chart and interaction engine |
| src/indicators.js | SMA, EMA, RSI calculation |
| src/heatmap.js | Live depth-history visualization |
| src/demo.js | Network-independent synthetic feed |
| src/main.js | Browser UI, lifecycle, settings |
| server.mjs | Zero-dependency local static server |
| test/ | Built-in Node test suite |

## Development notes

See docs/AUDIT.md, docs/FEATURE_MATRIX.md, docs/ARCHITECTURE.md, docs/NETWORK_MODEL.md, docs/MVP_SPEC.md, and docs/PERFORMANCE.md.

Sources: [Binance public market-data endpoints](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md), [Binance spot stream protocol](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md), [USDⓈ-M futures klines](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Kline-Candlestick-Data).

The design takes inspiration from the old BitcoinWisdom UX and the independent [Grossman 2020 MIT reconstruction](https://github.com/grossman8/bitcoin-wisdom-chart). No proprietary BitcoinWisdom source or upstream Grossman implementation was copied into this repository. See THIRD_PARTY_NOTICES.md.
