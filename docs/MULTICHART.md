# Multi-chart desk (v0.9)

BitcornWisdom runs a static, independent 1/2/4-chart workstation at `grid.html`; the classic order-book desk remains at `index.html`.

## Start

```sh
npm start
# open http://127.0.0.1:5173/grid.html?demo=1&mode=4
```

Synthetic demo feeds are explicitly labelled. Remove `demo=1` to subscribe to public exchange market data. The `mode` query parameter overrides the initially displayed layout, and each visible cell has its own exchange, symbol, interval, history request, reconnecting WebSocket and Canvas chart. Reducing chart count closes the hidden connections and clears their demo timers.

## Custom layouts

On desktop widths above 1150px, drag the thin separator between the two columns. Four-chart mode adds a horizontal row separator. Both handles accept arrow keys (2.5% steps) and Home/End (20%/80%). Ratios are bounded to 20–80% and saved locally. Smaller viewports stack charts; the desktop ratios are retained for later.

To keep multiple configurations, type a **layout name** and press **Save**. Selecting an existing name and saving updates it. Select a named layout and press **Load** to restore its four chart selections, count, split ratios, sync flags and demo setting. **Delete** asks for confirmation. Up to 20 names are saved locally in this browser.

**Export JSON** downloads one portable document containing the active layout, all named layouts and the current theme. **Import JSON** validates the file and restores those values, replacing existing saved layouts. The importer accepts only the versioned BitcornWisdom workspace schema, rejects files above 256 KiB, constrains symbols, intervals, counts, names and ratios, and uses DOM text APIs for all imported strings. Export files contain public chart configuration only and no credentials or market history.

The active layout is stored as `bitcornwisdom:grid:v2` and presets as `bitcornwisdom:grid:presets:v1`. Existing `bitcornwisdom:grid:v1` layouts are read on first visit and saved as v2 the next time settings change.

## Synchronization

**Sync crosshair** sends a hovered candle's UTC timestamp to peer charts; matching guides are drawn near the relevant local candle.

**Sync UTC view** projects the source chart's visible left/right UTC timestamps into each peer's candle indices. Fractional interpolation works across different intervals and gaps in exchange history, aligning the visible time window when the renderer's zoom range and available candles permit it. At the 2–45 px/bar renderer limits, the requested UTC midpoint remains the anchor. Missing historical overlap leaves the target untouched. Peers never load additional data merely to synchronize, and changing the setting does not modify the classic desk.

Mouse wheel zoom, drag pan and arrow-key navigation initiate a batched sync operation. Individual charts retain independent feeds, price scales, indicators and scroll state while sync is disabled.

## Boundaries and verification

The grid has a maximum of four visible public candle feeds and an 8,000-bar renderer cap; each grid feed initially requests only its exchange's recent REST page. Independent L2 ladders, recording and historical paging stay in the classic desk. The page remains static and read-only, subject to public exchange limits and regional API access. Browser refresh restores local settings when storage is available.

Run `npm run check` for Node tests (including UTC interpolation, v0.8 migration, presets and import rejection), and `npm run smoke:grid` for Chrome hydration/screenshot tests of all three grid sizes and their dividers. `npm run smoke:workspace` drives real pointer and keyboard input, tests preset persistence, exports, imports and rejects malformed workspaces, then reloads the page. Existing classic-desk, liquidity and live-feed workflows remain part of CI.
