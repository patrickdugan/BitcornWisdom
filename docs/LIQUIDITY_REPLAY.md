# Recorded liquidity and local replay (v0.5)

BitcornWisdom now records the **order-book liquidity visible to this browser while a market is open**. It restores earlier observations after a reload and lets you scrub or play them back on the heatmap.

This records **sampled, price-binned Level 2 observations**. It is not an exchange historical-depth API, an archive of the raw diff-depth event stream, or a reconstruction of liquidity that existed before you opened the chart. Closing the tab stops recording. Offline gaps are marked on the renderer so a missing hour cannot look like a continuous market event.

## Using it

Open any market and leave the chart active. Its verified depth feed will add approximately one sample per second. The heatmap and archive share the same samples.

After reloading the same market and symbol, IndexedDB restores locally recorded depth. Use **Replay** to move into a previous part of the recording, **Play** to advance through stored columns (1×, 4× or 16× nominal speed), the **timeline slider** to seek, and **Live** to return to incoming samples. Recording continues while replay is paused. **Erase** deletes stored samples for the selected market/symbol after confirmation.

Demo data has a separate demo namespace. Historical samples are scoped to live/demo, venue and symbol, independent of candle timeframe. The original exchange source tag and event timestamp are retained alongside the local capture timestamp.

## Schema and bounds

IndexedDB database: bitcornwisdom-liquidity-v1, version 1.

- Object store samples, compound primary key (series, at).
- Secondary index byAt for age and global-cap pruning.
- Per-row series, at, exchangeAt, source, price, levels, version.
- Levels is a list of up to **200** positive price bins containing approximate base quantity. Binning takes a ±1% price band around the current mid/price.
- Capture timestamp at is the browser observation time in Unix milliseconds. exchangeAt is optional exchange event time. The source string records feed provenance.

The UI loads at most **6,000** recent columns for its timeline and displays at most **160** per heatmap frame. IndexedDB retains at most **12,000 records globally** across all markets and periodically removes rows older than **24 hours**. Frequent trading across many markets can evict earlier recordings before their age limit.

Storage is best-effort. Browsers can deny or clear IndexedDB, including in private browsing. The UI reports whether local persistence is active. When storage is unavailable, the heatmap continues in memory for the current page.

## Accuracy

- Binance: samples only after snapshot/sequence bridging for the selected bounded depth stream.
- Kraken: samples after CRC32-verifiable updates to the 25-level book.
- Coinbase Exchange: samples from the ordered snapshot/update L2 feed. This carries different integrity guarantees than Kraken's checksummed book.
- Price bins retain approximate base quantities derived from summed quote notional divided by bin midpoint. Exact order-by-order messages, cancellations between samples, per-venue maker identity, and book changes outside the band are absent.
- Any gap greater than four seconds between sampled observations breaks the overlaid price line and receives a thin gap marker.

Playback steps through recorded samples, not simulated milliseconds of execution. The speed selector expresses nominal samples per second when the recorder samples at roughly 1 Hz.

For reproducible research on historical market impact, the next major architecture would be a separately hosted raw depth recorder, maintaining per-venue sequence IDs, timestamps, reconnect/gap markers and lossless append-only event storage. The present client provides a local observation timeline and basic replay rather than that infrastructure.

## Tests

Run npm run check for sample validation, deduplication, source separation, replay anchoring and clock throttling. npm run smoke:archive launches a disposable Chrome profile, records synthetic observations, seeds a longer synthetic demo recording, reloads to verify IndexedDB persistence, scrubs, checks market isolation, erases the selected archive, and captures bitcorn-liquidity-replay.png.

Use ?demo=1 to experiment without real market connectivity. Synthetic seeds are isolated in an ephemeral test profile and never written to user market history.
