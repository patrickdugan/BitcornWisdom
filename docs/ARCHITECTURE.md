# Architecture

    Binance public REST -> fetchCandles -> normalized OHLCV ──┐
                                                             ├─ Canvas2D chart
    Binance public WebSocket -> kline -> upsertCandle ────────┤  + SMA / EMA
                             -> trade -> recent trade tape   │  + trend lines
                             -> depth20 -> order-book ladder ├─ heatmap
                                          + rolling snapshots│
    localStorage ---------------------------------------------┘

**No JavaScript runtime dependencies.** The browser uses native modules; the optional local server is plain Node HTTP. A market-data server becomes useful when persistent historical depth, alerts, aggregation or shared WebSocket fanout are justified.

The chart has a separate coordinate model for candle index ↔ x, price ↔ y, with linear/logarithmic modes and bounded visible-window drawing. A current market session owns one abortable REST history request and one reconnecting WebSocket. Switching markets invalidates that session; old callbacks are ignored.

Binance spot and futures data map to the same candle, trade, and partial-depth representation. The order-book view deliberately uses self-contained top-20 depth packets. A full book requires documented Binance snapshot/delta sequence reconciliation and recovery after gaps, which belongs in the next milestone.

The heatmap takes at most one partial depth sample per ~950 ms. Its 160-column ring uses log1p(quantity × price) for intensity and a compact viridis ramp. This is an MVP visualization of the nearest live liquidity levels. It cannot stand in for historical L2 data.

Security scope: read-only public exchange data, alphanumeric symbol/known interval validation, localStorage only, no secrets or accounts. The server allows only public app assets. Browser market-data traffic goes to official exchange hosts.

Tests cover parsing, normalization, candle upserts, indicator indexing, coordinate transforms, log inverse scales, depth ordering and demo reproducibility.
