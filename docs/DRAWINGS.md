# Chart drawing tools (v0.7)

BitcornWisdom supports four annotation types inside the independent Canvas2D chart: two-point trend lines, horizontal price levels, vertical time markers, and Fibonacci retracements.

## How to draw

Choose a tool from the DRAW selector in the chart toolbar. You can also use the command deck (Ctrl/Cmd+K, then search Fibonacci or Horizontal) or the single-key shortcuts when a text input is not focused.

| Key | Tool | Interaction |
| --- | --- | --- |
| D | Select | Click a line or anchor, then drag to change position |
| L | Trend | Click two points for a trend line |
| H | Level | Single click anchors a full-width horizontal price level |
| V | Time | Single click places a vertical time marker |
| F | Fibonacci | Click two anchors; seven standard retracement levels appear |

Fibonacci ratios are 0, 23.6, 38.2, 50, 61.8, 78.6, and 100 percent, interpolated linearly between the selected prices. They remain attached to absolute prices. Switching to a logarithmic price axis changes their visual spacing, not the price levels. The renderer skips colliding text labels while preserving all seven level lines.

Hold Shift while positioning an anchor near the open/high/low/close of a candle to snap to its exact price (within approximately eleven pixels). Otherwise, the cursor uses the nearest candle timestamp and the displayed price scale.

## Editing and removal

Switch to Select (D), then click an anchor to adjust it or click a line body to translate the whole annotation. Horizontal levels move in price; vertical markers move in time. Trend and Fibonacci annotations have movable endpoints.

Use the ✕ toolbar button or Delete/Backspace with the chart focused to delete the selected annotation. Ctrl/Cmd+Z undoes additions, edits and deletions, with up to fifty undo snapshots. Escape or right-click cancels an incomplete two-click drawing. The command deck offers Clear drawings with confirmation.

The toolbar counter shows saved annotation count; the limit is 200 per market/timeframe.

## Persistence

The existing per-market and per-timeframe localStorage key continues to be used. Records include the type and two normalized endpoints containing Unix-millisecond time and price. Older untyped saved lines are accepted as trend lines. Invalid records are ignored.

Drawings are saved locally rather than sent to exchanges. The client-side chart PNG export includes the currently visible annotations.

## Technical limits

This is a drawing toolkit, not Pine Script, a strategy engine or a trading-order interface. It does not automatically identify support/resistance or import proprietary chart layouts.

The geometry and hit-test functions are in src/drawings.js and the Canvas renderer/pointer state machine lives in src/chart.js. Tests cover pure geometry, legacy-line migration, editing, deletion, undo, and Chromium browser persistence.

Price/time anchor translation currently relies on candle-index coordinate mapping; trading sessions with historical time gaps merit future improvement.
