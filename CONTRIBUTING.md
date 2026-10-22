# Contributing to BitcornWisdom

BitcornWisdom is MIT-licensed, built to remain approachable, and welcomes improvements to the market desk, chart engine, exchange feeds, tests, documentation, and accessibility.

## Development setup

Node 20+ and Chrome/Chromium are needed for the complete smoke suite.

    git clone https://github.com/patrickdugan/BitcornWisdom.git
    cd BitcornWisdom
    npm start

There are no runtime or development npm dependencies, and no exchange credentials are required.

Before proposing changes:

    npm run check
    npm run smoke
    npm run smoke:archive

The optional browser:live and probe:live commands require outbound access to public exchanges. Regional HTTP errors and network restrictions are operational diagnostics rather than deterministic test failures.

## Useful contributions

- Faster, more accessible Canvas chart and keyboard behavior.
- More public exchange adapters with tested candle and order-book normalization.
- Technical indicators, drawing tools, symbol search, and responsive layouts.
- Portable local settings, test fixtures, and perf measurements.

Keep changes focused. Open an issue describing the behavior and the expected result for larger proposals. Small pull requests with clear tests are easier to review.

## Design and safety

Prefer native browser APIs and auditable modules. Use Unix-millisecond candle timestamps and correct venue-specific order-book synchronization. Mark all simulated market data. Avoid presenting a partial book as a complete market history.

Do not add trading, order signing, API credentials, telemetry, or remote script execution without a separately reviewed security design. Follow public exchange rate limits and geographical restrictions.

Review code constructively, communicate professionally, and make feedback reproducible.

## Pull request checklist

Explain the purpose, implementation, and tests. Attach screenshots for visual changes. Adapter changes should cover malformed packets, snapshot/delta consistency, reconnects, and out-of-order events. Preserve attribution for third-party MIT-compatible source.

For security reports, use the private disclosure route outlined in SECURITY.md.
