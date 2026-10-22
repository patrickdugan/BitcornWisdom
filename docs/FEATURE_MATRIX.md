# Feature matrix

The original column reflects historical BitcoinWisdom descriptions. The Grossman column is grounded in its published 2020 code. Implemented means code is in BitcornWisdom; live-network/browser verification is a separate question.

| Feature | Historic BitcoinWisdom | Grossman 2020 | BitcornWisdom v0.1 |
| --- | --- | --- | --- |
| Candles / volume | Yes | Candles, volume data | Implemented |
| Pan / wheel / arrows | Yes | Yes | Implemented |
| Crosshair / OHLC | Yes | Partial | Implemented |
| Linear / log scale | Yes | Linear only | Implemented |
| EMA / MA | Yes | Missing | EMA20 / SMA50 |
| Bollinger / SAR | Yes | Missing | Later |
| MACD / RSI / StochRSI | Yes | Missing | RSI math only, pane later |
| KDJ / DMI / CMF / OBV | Yes | Missing | Later |
| Trend lines | Yes | Basic | Implemented |
| Fibonacci | Yes | Missing | Later |
| Public Spot feed | Yes | Needs bespoke server | Binance Spot |
| Public Futures feed | Yes | BitMEX listed | Binance USDⓈ-M |
| Trade tape | Yes | Socket subscription | Implemented |
| Order book | Yes | Reader only | Top-20 partial snapshots |
| Liquidity heatmap | Yes | Missing | Rolling top-20 only |
| Aggregated heatmap | Yes | Missing | Later |
| Local drawings | Yes | In memory | localStorage |
| Alerts | Yes | Missing | Later |
| No TradingView | Yes | Yes | Yes |
