# Renderer measurement plan

No measured browser FPS or per-frame latency numbers are claimed yet. Unit tests cover coordinate transforms, including invertibility under zoom and pan. The current client requests 1,000 candles and retains at most 1,200 after live updates.

Benchmark Chromium and Firefox at 1,000, 10,000 and 100,000 synthetic bars. Fix viewport to 1200×700, then compare first draw, drag/zoom FPS, main-thread long tasks, memory, and devicePixelRatio 1x versus 2x. Record performance before choosing WebGL.

Canvas currently renders only visible candles based on width/barWidth. EMA/SMA recompute from the full loaded array on redraw, which should be cached incrementally before scaling to 100k bars. Extend historical candle paging with careful gap management before interpreting any 100k-bar benchmark as a real data test.
