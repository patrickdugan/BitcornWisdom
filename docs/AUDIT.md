# Audit: Grossman BitcoinWisdom reconstruction

Reference: https://github.com/grossman8/bitcoin-wisdom-chart (MIT). Reviewed published source, README, rendering implementation, drawing behavior and data adapters.

| Source file | Decision | Findings |
| --- | --- | --- |
| src/chart/timeseries.js | REWRITE, retain UX | Canvas pixel candlesticks, scroll zoom, drag pan, arrows, crosshair. D3 scales are used. Log scale is an explicit TODO. |
| src/chart/drawings.js | REWRITE | Two-point line geometry, cursor and last-line removal. No durable drawings state. |
| src/chart/live_chart.js | REWRITE | Trade-driven OHLC mutation, with scheduling math that warrants a milliseconds/seconds audit. Direct kline updates are simpler and authoritative. |
| src/chart/Chart.svelte | REMOVE | Thin host of chart and drawing classes. |
| src/Main.svelte | REWRITE | Hardcoded markets and interval controls, minimal state. |
| src/lib/exchange.js | REWRITE | Relies on a bespoke HTTP timeseries server and Socket.IO channels. An unsubscribed callback is not the same function reference as the subscribed callback. |
| src/lib/socket.js | REMOVE | Assumes private Socket.IO/JWT service. |
| src/main.js | REMOVE | Svelte bootstrap only. |
| public/global.css | REWRITE | Layout tied to the older component structure. |
| Rollup and package-lock | REMOVE | Unnecessary dependency surface for the current plain-browser MVP. |
| Config file and market-data server | MISSING | README asks the user to create configuration and supply REST and Socket.IO services. |
| Heatmap, indicators, full-depth reconciliation, persistence | MISSING | Outside the published reconstruction. |

The old Canvas drawing and interactions were worth studying. The new implementation uses independent conversion functions, native JS browser modules, normalized Unix-millisecond candles, and current public exchange feeds. Grossman's original code remains only a reference, with attribution.

Potential issues in the old source include incomplete LOG scaling, in-memory drawings, trade candle-timer unit assumptions and unbalanced event teardown. These informed targeted new tests. This audit makes no claim about private original BitcoinWisdom internals.
