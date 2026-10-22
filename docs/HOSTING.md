# Hosting BitcornWisdom

The application consists of static browser assets, with direct public REST/WebSocket exchange feeds and no build step. Node is used only for its small local static server.

## Local development

    npm start

Open http://127.0.0.1:5173/ for live feeds. Add ?demo=1 to use the deterministic offline market.

Bind a different interface or port as needed:

    HOST=127.0.0.1 PORT=5188 npm start

Use trusted interfaces or a correctly configured HTTPS reverse proxy when exposing the local server.

## Static hosting and GitHub Pages

The root index.html loads styles.css, favicon.svg and the src modules through relative paths. Any ordinary static host may serve the project from its root or a subdirectory; URL navigation uses only query parameters for exchange, symbol and timeframe.

For GitHub Pages, choose your repository's Pages deployment source and publish the repository root through its static-site workflow. This repo does not automatically enable GitHub Pages or turn on public hosting.

Cloudflare Pages, Netlify and Nginx can also serve the root without a build command.

## Network and privacy

Browsers request public market data directly from Binance, Kraken and Coinbase, subject to each venue's CORS, region and rate restrictions. Keep public deployments on HTTPS.

IndexedDB liquidity archives, favorites and chart settings are local to the origin and browser. A localhost deployment and a publicly hosted deployment have different storage. There is no hosted account service, telemetry dependency or secret key requirement.

PNG chart export happens locally in the browser. No screenshot data is uploaded.

## Release checks

Run npm run check, npm run smoke and npm run smoke:archive. Review the resulting Chrome screenshot artifact and check desktop/mobile breakpoints. Live probes are optional diagnostics.
